window.createEvercoldTimeline = function createEvercoldTimeline() {
const materialClock = { progress: 0 };
const timeline = gsap.timeline({ paused: true });

const proofBeats = [
  {
    id: "#proof-bastion-hook",
    start: 0,
    end: 3.8,
    fromScale: 0.92,
    fromY: 34,
  },
  {
    id: "#proof-bastion-character",
    start: 3.1,
    end: 8.3,
    fromScale: 0.94,
    fromY: 68,
  },
  {
    id: "#proof-evolved-mode",
    start: 7.8,
    end: 12.2,
    fromScale: 0.94,
    fromY: -34,
  },
  {
    id: "#proof-naglfar-one",
    start: 11.6,
    end: 13.6,
    fromScale: 0.95,
    fromY: 24,
  },
  {
    id: "#proof-naglfar-two",
    start: 13.2,
    end: 15,
    fromScale: 0.95,
    fromY: -20,
  },
  {
    id: "#proof-lifestream",
    start: 16.4,
    end: 19.7,
    fromScale: 0.94,
    fromY: 32,
  },
  {
    id: "#proof-evercold-key-art",
    start: 20.2,
    end: 23.2,
    fromScale: 0.95,
    fromY: 54,
  },
];

proofBeats.forEach((beat) => {
  const duration = beat.end - beat.start;
  const fadeDuration = Math.min(0.38, duration * 0.18);

  timeline.set(beat.id, { autoAlpha: 1 }, beat.start);
  timeline.fromTo(
    `${beat.id} .proof-frame`,
    {
      scale: beat.fromScale,
      y: beat.fromY,
      filter: "saturate(0.82) brightness(0.78)",
    },
    {
      scale: 1,
      y: 0,
      filter: "saturate(1) brightness(1)",
      duration: Math.min(1.5, duration * 0.56),
      ease: "power3.out",
    },
    beat.start,
  );
  timeline.fromTo(
    `${beat.id} .proof-label`,
    { x: 18, autoAlpha: 0 },
    {
      x: 0,
      autoAlpha: 1,
      duration: Math.min(0.46, duration * 0.22),
      ease: "power2.out",
    },
    beat.start + 0.12,
  );
  timeline.to(
    beat.id,
    {
      autoAlpha: 0,
      duration: fadeDuration,
      ease: "power2.in",
    },
    beat.end - fadeDuration,
  );
  timeline.set(beat.id, { visibility: "hidden" }, beat.end);
});

timeline.fromTo(
  ".shield-reticle",
  { rotation: -7, scale: 0.82, autoAlpha: 0 },
  {
    rotation: 7,
    scale: 1,
    autoAlpha: 0.72,
    duration: 3.2,
    ease: "power2.out",
  },
  0.08,
);

timeline.to(
  materialClock,
  { progress: 1, duration: 28, ease: "none" },
  0,
);

return timeline;
};
