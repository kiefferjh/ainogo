export const experimentConfig = {
  randomizeImageOrder: true,
  ratingOrder: ['valence', 'arousal'] as const,
  showImageDuringRating: true,
  timeLimitMs: null,
  enableKeyboard: true,
  enableMouse: true,
};

export const ratingPrompts = {
  valence: {
    question:
      'Rate this picture based on how happy (pleased, satisfied, contented, and hopeful) or unhappy (annoyed, unsatisfied, bored, melancholic) it makes you feel',
    lowAnchor: 'This picture makes me feel completely unhappy',
    highAnchor: 'This picture makes me feel completely happy',
  },
  arousal: {
    question:
      'Rate this picture based on how aroused (excited, stimulated, frenzied, jittery, awake) or unaroused (relaxed, calm, dull, sluggish) it makes you feel',
    lowAnchor: 'I am completely unaroused when I look at this picture',
    highAnchor: 'I am completely aroused when I look at this picture',
  },
} as const;
