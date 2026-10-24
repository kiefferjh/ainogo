import './style.css';
import { images } from './images';
import { experimentConfig, ratingPrompts } from './config';

type Screen = 'welcome' | 'instructions' | 'rating' | 'complete';
type RatingDimension = 'valence' | 'arousal';
type ImageResponse = {
  sessionId: string;
  imageId: string;
  imageOrder: number;
  valence: number;
  arousal: number;
};

const sessionId = crypto.randomUUID();

const shuffle = <T>(items: T[]): T[] => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
};

const sessionImages = experimentConfig.randomizeImageOrder ? shuffle(images) : [...images];

let currentScreen: Screen = 'welcome';
let currentDimension: RatingDimension = experimentConfig.ratingOrder[0];
let currentImageIndex = 0;
const responses: ImageResponse[] = [];
const ratings: Record<RatingDimension, number | null> = {
  valence: null,
  arousal: null,
};

const startButton = document.querySelector<HTMLButtonElement>('#start-button');
const screenDescription = document.querySelector<HTMLParagraphElement>('#screen-description');
const statusMessage = document.querySelector<HTMLParagraphElement>('#status');
const ratingPanel = document.querySelector<HTMLElement>('#rating-panel');
const studyImage = document.querySelector<HTMLImageElement>('#study-image');
const ratingButtons = document.querySelector<HTMLDivElement>('#rating-buttons');
const ratingQuestion = document.querySelector<HTMLHeadingElement>('#rating-question');
const scaleLabels = document.querySelector<HTMLParagraphElement>('#scale-labels');

if (!startButton || !screenDescription || !statusMessage || !ratingPanel || !studyImage || !ratingButtons || !ratingQuestion || !scaleLabels) {
  throw new Error('The page is missing a required screen element.');
}

// Create the scale once. Each button's handler remembers its own value.
for (let value = 1; value <= 9; value++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = String(value);
  button.addEventListener('click', () => {
    if (currentScreen !== 'rating' || ratings[currentDimension] !== null) return;

    ratings[currentDimension] = value;

    const dimensionIndex = experimentConfig.ratingOrder.indexOf(currentDimension);
    if (dimensionIndex < experimentConfig.ratingOrder.length - 1) {
      currentDimension = experimentConfig.ratingOrder[dimensionIndex + 1];
    } else {
      if (ratings.valence === null || ratings.arousal === null) {
        throw new Error('Both ratings are required before advancing.');
      }

      // Copy the values into a new record before clearing the current ratings.
      responses.push({
        sessionId,
        imageId: sessionImages[currentImageIndex].id,
        imageOrder: currentImageIndex + 1,
        valence: ratings.valence,
        arousal: ratings.arousal,
      });

      if (currentImageIndex < images.length - 1) {
        currentImageIndex++;
        currentDimension = experimentConfig.ratingOrder[0];
        ratings.valence = null;
        ratings.arousal = null;
      } else {
        currentScreen = 'complete';
      }
    }

    render();
  });
  ratingButtons.append(button);
}

// Read the current state and update the visible page to match it.
const render = () => {
  ratingPanel.hidden = currentScreen !== 'rating';
  startButton.hidden = currentScreen === 'rating' || currentScreen === 'complete';
  statusMessage.textContent = '';

  if (currentScreen === 'welcome') {
    screenDescription.textContent = `You will rate ${sessionImages.length} images for pleasantness and arousal.`;
    startButton.textContent = 'Start';
  } else if (currentScreen === 'instructions') {
    screenDescription.textContent =
      'For each image, you will give two ratings on a scale from 1 to 9: ' +
      'one for valence (pleasantness) and one for arousal. ' +
      'The final study instructions will be added once the study design is confirmed.';
    startButton.textContent = 'Begin';
  } else if (currentScreen === 'rating') {
    const image = sessionImages[currentImageIndex];
    studyImage.src = image.src;
    studyImage.alt = image.alt;
    screenDescription.textContent =
      `Image ${currentImageIndex + 1} of ${sessionImages.length}: select one ${currentDimension} rating below.`;

    if (currentDimension === 'valence') {
      ratingQuestion.textContent = ratingPrompts.valence.question;
      scaleLabels.textContent = `1 = ${ratingPrompts.valence.lowAnchor}; 9 = ${ratingPrompts.valence.highAnchor}`;
    } else {
      ratingQuestion.textContent = ratingPrompts.arousal.question;
      scaleLabels.textContent = `1 = ${ratingPrompts.arousal.lowAnchor}; 9 = ${ratingPrompts.arousal.highAnchor}`;
      statusMessage.textContent = 'Valence recorded. Now rate arousal.';
    }
  } else {
    screenDescription.textContent = 'Development trials complete.';
    statusMessage.textContent =
      responses.map((response) =>
        `${response.imageOrder}. ${response.imageId}: valence ${response.valence}, arousal ${response.arousal}.`
      ).join(' ') + ' ' +
      'These responses are only in memory and are not saved to a file. Refresh to try again.';
  }
};

startButton.addEventListener('click', () => {
  if (currentScreen === 'welcome') {
    currentScreen = 'instructions';
    render();
  } else if (currentScreen === 'instructions') {
    currentScreen = 'rating';
    render();
  }
});

render();
