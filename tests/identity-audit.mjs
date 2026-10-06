// Executado no DOM das cópias isoladas da aplicação.
export function auditIdentity() {
  const rgba = value => (value.match(/[\d.]+/g) || []).map(Number);
  const luminance = channels => {
    const [r,g,b] = channels.map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    return r * .2126 + g * .7152 + b * .0722;
  };
  const background = element => {
    const stack = [];
    for (let node = element; node; node = node.parentElement) stack.unshift(rgba(getComputedStyle(node).backgroundColor));
    return stack.reduce((base, color) => {
      const alpha = color[3] ?? 1;
      return base.map((value, index) => color[index] * alpha + value * (1-alpha));
    }, [247,242,234]);
  };
  const issues = [];
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') continue;
    if (!([...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) || element.matches('input,textarea,select'))) continue;
    if (element.closest('[hidden], [disabled], [aria-hidden="true"]')) continue;
    const text = (element.innerText || element.value || element.placeholder || '').slice(0,70);
    if (!style.fontFamily.includes('Manrope')) issues.push({kind:'font',class:element.className,text,font:style.fontFamily});
    const surface = background(element), foreground = rgba(style.color).slice(0,3);
    const first=luminance(surface), second=luminance(foreground);
    const ratio=(Math.max(first,second)+.05)/(Math.min(first,second)+.05);
    const large=parseFloat(style.fontSize)>=24 || parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700;
    if (ratio < (large?3:4.5)) issues.push({kind:'contrast',class:element.className,text,ratio:Number(ratio.toFixed(2)),color:style.color,surface});
  }
  return issues.slice(0,35);
}
