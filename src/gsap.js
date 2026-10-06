import { gsap } from 'gsap';
import { MotionPathHelper } from 'gsap/MotionPathHelper';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { SplitText } from 'gsap/SplitText';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';

// ScrollSmoother depende de ScrollTrigger; registrar não cria efeitos no site.
gsap.registerPlugin(MotionPathPlugin, MotionPathHelper, ScrollTrigger, ScrollSmoother, SplitText, MorphSVGPlugin);

export { gsap, MotionPathHelper, MotionPathPlugin, ScrollTrigger, ScrollSmoother, SplitText, MorphSVGPlugin };
