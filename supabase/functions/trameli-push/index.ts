
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_SUBJECT = "https://shirleypedidos.trameli.workers.dev";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatch-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function ensureVapid() {
  const current = await admin.rpc("trameli_push_vapid_config");
  if (current.error) throw current.error;
  let row = Array.isArray(current.data) ? current.data[0] : current.data;

  if (!row?.public_key || !row?.private_key) {
    const keys = webpush.generateVAPIDKeys();
    const saved = await admin.rpc("trameli_store_vapid_config", {
      p_public_key: keys.publicKey,
      p_private_key: keys.privateKey,
      p_subject: VAPID_SUBJECT,
    });
    if (saved.error) throw saved.error;
    row = { public_key: keys.publicKey, private_key: keys.privateKey, subject: VAPID_SUBJECT };
  }

  webpush.setVapidDetails(
    row.subject || VAPID_SUBJECT,
    row.public_key,
    row.private_key,
  );
  return row.public_key as string;
}

async function authenticatedUser(req: Request) {
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

async function canDispatch(req: Request, notificationId: string) {
  const user = await authenticatedUser(req);
  if (!user) return false;

  const [operatorResult, notificationResult] = await Promise.all([
    admin.from("trameli_operators").select("user_id").eq("user_id", user.id).maybeSingle(),
    admin.from("trameli_notifications")
      .select("created_by,kind")
      .eq("id", notificationId)
      .maybeSingle(),
  ]);

  if (operatorResult.data) return true;
  return Boolean(
    notificationResult.data
    && notificationResult.data.created_by === user.id
    && notificationResult.data.kind === "system"
  );
}

async function dispatchNotification(notificationId: string) {
  const claimed = await admin.rpc("trameli_claim_notification", {
    p_notification_id: notificationId,
  });
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return { notificationId, skipped: true };

  const [notificationResult, recipientResult] = await Promise.all([
    admin.from("trameli_notifications")
      .select("id,title,body,url,kind,metadata")
      .eq("id", notificationId)
      .single(),
    admin.from("trameli_notification_recipients")
      .select("user_id")
      .eq("notification_id", notificationId),
  ]);
  if (notificationResult.error) throw notificationResult.error;
  if (recipientResult.error) throw recipientResult.error;

  const notification = notificationResult.data;
  const userIds = [...new Set((recipientResult.data || []).map((row) => row.user_id).filter(Boolean))];

  if (!userIds.length) {
    await admin.from("trameli_notifications").update({
      status: "failed",
      sent_count: 0,
      failed_count: 0,
      updated_at: new Date().toISOString(),
    }).eq("id", notificationId);
    return { notificationId, sent: 0, failed: 0, noSubscription: 0 };
  }

  const [subscriptionsResult, unreadResult] = await Promise.all([
    admin.from("trameli_push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth_secret")
      .in("user_id", userIds)
      .eq("enabled", true),
    admin.from("trameli_notification_recipients")
      .select("user_id")
      .in("user_id", userIds)
      .is("read_at", null),
  ]);
  if (subscriptionsResult.error) throw subscriptionsResult.error;
  if (unreadResult.error) throw unreadResult.error;

  const byUser = new Map<string, any[]>();
  for (const subscription of subscriptionsResult.data || []) {
    const list = byUser.get(subscription.user_id) || [];
    list.push(subscription);
    byUser.set(subscription.user_id, list);
  }

  const unreadByUser = new Map<string, number>();
  for (const row of unreadResult.data || []) {
    unreadByUser.set(row.user_id, (unreadByUser.get(row.user_id) || 0) + 1);
  }

  const sentUsers: string[] = [];
  const failedUsers: string[] = [];
  const noSubscriptionUsers: string[] = [];
  const deadSubscriptionIds: string[] = [];

  const sendUser = async (userId: string) => {
    const subscriptions = byUser.get(userId) || [];
    if (!subscriptions.length) {
      noSubscriptionUsers.push(userId);
      return;
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: notification.url || "/#loja",
      tag: "pao-doce-" + notification.id,
      renotify: true,
      badgeCount: unreadByUser.get(userId) || 1,
      data: {
        notificationId: notification.id,
        kind: notification.kind,
        ...(notification.metadata || {}),
      },
    });

    let successes = 0;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth_secret,
          },
        }, payload, { TTL: 86400, urgency: "normal" });
        successes += 1;
      } catch (cause: any) {
        const statusCode = Number(cause?.statusCode || cause?.status || 0);
        if (statusCode === 404 || statusCode === 410) {
          deadSubscriptionIds.push(subscription.id);
        }
      }
    }

    if (successes > 0) sentUsers.push(userId);
    else failedUsers.push(userId);
  };

  for (let index = 0; index < userIds.length; index += 20) {
    await Promise.all(userIds.slice(index, index + 20).map(sendUser));
  }

  const now = new Date().toISOString();
  const updates: PromiseLike<any>[] = [];
  if (sentUsers.length) {
    updates.push(admin.from("trameli_notification_recipients")
      .update({ delivery_status: "sent", delivered_at: now, error_code: null })
      .eq("notification_id", notificationId)
      .in("user_id", sentUsers));
  }
  if (failedUsers.length) {
    updates.push(admin.from("trameli_notification_recipients")
      .update({ delivery_status: "failed", error_code: "push_failed" })
      .eq("notification_id", notificationId)
      .in("user_id", failedUsers));
  }
  if (noSubscriptionUsers.length) {
    updates.push(admin.from("trameli_notification_recipients")
      .update({ delivery_status: "no_subscription", error_code: null })
      .eq("notification_id", notificationId)
      .in("user_id", noSubscriptionUsers));
  }
  if (deadSubscriptionIds.length) {
    updates.push(admin.from("trameli_push_subscriptions")
      .update({ enabled: false, revoked_at: now, updated_at: now })
      .in("id", deadSubscriptionIds));
  }
  await Promise.all(updates);

  const failedCount = failedUsers.length + noSubscriptionUsers.length;
  const status = sentUsers.length === userIds.length
    ? "sent"
    : sentUsers.length > 0
      ? "partial"
      : "failed";

  const finalUpdate = await admin.from("trameli_notifications").update({
    status,
    sent_count: sentUsers.length,
    failed_count: failedCount,
    updated_at: now,
    sent_at: sentUsers.length ? now : null,
  }).eq("id", notificationId);
  if (finalUpdate.error) throw finalUpdate.error;

  return {
    notificationId,
    sent: sentUsers.length,
    failed: failedUsers.length,
    noSubscription: noSubscriptionUsers.length,
  };
}

async function validDispatchToken(req: Request) {
  const supplied = req.headers.get("X-Dispatch-Token") || "";
  if (!supplied) return false;
  const expected = await admin.rpc("trameli_push_dispatch_token");
  if (expected.error || !expected.data) return false;
  return supplied.length === expected.data.length && supplied === expected.data;
}

async function dispatchQueued() {
  const queued = await admin.from("trameli_notifications")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(15);
  if (queued.error) throw queued.error;

  const results = [];
  for (const row of queued.data || []) {
    try {
      results.push(await dispatchNotification(row.id));
    } catch (cause: any) {
      results.push({ notificationId: row.id, error: cause?.message || "dispatch_failed" });
    }
  }
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    await ensureVapid();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "dispatch_queued") {
      if (!(await validDispatchToken(req))) return json({ error: "forbidden" }, 403);
      return json({ ok: true, results: await dispatchQueued() });
    }

    if (action === "dispatch" && body?.notificationId) {
      const notificationId = String(body.notificationId);
      if (!(await canDispatch(req, notificationId))) {
        return json({ error: "forbidden" }, 403);
      }
      return json({ ok: true, result: await dispatchNotification(notificationId) });
    }

    if (action === "health") return json({ ok: true });
    return json({ error: "invalid_action" }, 400);
  } catch (cause: any) {
    console.error("trameli-push", cause?.message || cause);
    return json({ error: "push_dispatch_failed" }, 500);
  }
});
