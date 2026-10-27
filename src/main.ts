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

try {
  // randomUUID requires a secure context; getRandomValues also works on HTTP.
  const sessionId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

  if (images.length === 0) {
    throw new Error('The study must contain at least one image.');
  }

  if (images.some(image => !image.id.trim() || !image.src.trim()) ||
      new Set(images.map(image => image.id)).size !== images.length) {
    throw new Error('Study images must have unique, non-empty IDs and valid source paths.');
  }

  if (experimentConfig.ratingOrder.length !== 2 ||
      !experimentConfig.ratingOrder.includes('valence') ||
      !experimentConfig.ratingOrder.includes('arousal')) {
    throw new Error('The study must configure valence and arousal ratings.');
  }

  if (!experimentConfig.enableMouse && !experimentConfig.enableKeyboard) {
    throw new Error('At least one rating input method must be enabled.');
  }

  if (!experimentConfig.showImageDuringRating) {
    throw new Error('Image-hidden trials require a presentation phase, which is not configured yet.');
  }

  if (experimentConfig.timeLimitMs !== null &&
      (!Number.isFinite(experimentConfig.timeLimitMs) || experimentConfig.timeLimitMs <= 0 ||
        experimentConfig.timeLimitMs > 2_147_483_647)) {
    throw new Error('The time limit must be null or a positive number no greater than 2147483647 ms.');
  }

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
  let ratingTimer: ReturnType<typeof setTimeout> | null = null;
  let imageLoadTimer: ReturnType<typeof setTimeout> | null = null;
  let imageState: 'loading' | 'ready' | 'error' = 'loading';
  let displayedImageIndex = -1;
  let imageRetryCount = 0;
  let focusedRating = '';
  let promptVersion = 0;
  let promptReady = false;
  let promptFrame: number | null = null;

  const startButton = document.querySelector<HTMLButtonElement>('#start-button');
  const screenDescription = document.querySelector<HTMLParagraphElement>('#screen-description');
  const statusMessage = document.querySelector<HTMLParagraphElement>('#status');
  const ratingPanel = document.querySelector<HTMLElement>('#rating-panel');
  const studyImage = document.querySelector<HTMLImageElement>('#study-image');
  const ratingButtons = document.querySelector<HTMLDivElement>('#rating-buttons');
  const ratingQuestion = document.querySelector<HTMLHeadingElement>('#rating-question');
  const scaleLabels = document.querySelector<HTMLParagraphElement>('#scale-labels');
  const retryImage = document.querySelector<HTMLButtonElement>('#retry-image');

  if (!startButton || !screenDescription || !statusMessage || !ratingPanel || !studyImage || !ratingButtons || !ratingQuestion || !scaleLabels || !retryImage) {
    throw new Error('The page is missing a required screen element.');
  }

  studyImage.hidden = !experimentConfig.showImageDuringRating;

  const clearRatingTimer = () => {
    if (ratingTimer !== null) {
      clearTimeout(ratingTimer);
      ratingTimer = null;
    }
  };

  const clearImageLoadTimer = () => {
    if (imageLoadTimer !== null) {
      clearTimeout(imageLoadTimer);
      imageLoadTimer = null;
    }
  };

  const cancelPromptPresentation = () => {
    if (promptFrame !== null) cancelAnimationFrame(promptFrame);
    promptFrame = null;
    promptReady = false;
  };

  const recordRating = (value: number) => {
    if (currentScreen !== 'rating' || imageState !== 'ready' || !promptReady ||
        !Number.isInteger(value) || value < 1 || value > 9 || ratings[currentDimension] !== null) return;

    promptVersion++;
    ratings[currentDimension] = value;

    const dimensionIndex = experimentConfig.ratingOrder.indexOf(currentDimension);
    if (dimensionIndex < experimentConfig.ratingOrder.length - 1) {
      currentDimension = experimentConfig.ratingOrder[dimensionIndex + 1];
    } else {
      if (ratings.valence === null || ratings.arousal === null) {
        throw new Error('Both ratings are required before advancing.');
      }

      responses.push({
        sessionId,
        imageId: sessionImages[currentImageIndex].id,
        imageOrder: currentImageIndex + 1,
        valence: ratings.valence,
        arousal: ratings.arousal,
      });

      if (currentImageIndex < sessionImages.length - 1) {
        currentImageIndex++;
        imageRetryCount = 0;
        currentDimension = experimentConfig.ratingOrder[0];
        ratings.valence = null;
        ratings.arousal = null;
      } else {
        currentScreen = 'complete';
        clearRatingTimer();
      }
    }

    render();
  };

  // Create the scale once. Each button's handler remembers its own value.
  for (let value = 1; value <= 9; value++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(value);
    let pointerPrompt: number | null = null;
    button.addEventListener('pointerdown', () => {
      pointerPrompt = imageState === 'ready' && promptReady ? promptVersion : -1;
    });
    button.addEventListener('click', (event) => {
      if (event.detail > 0) {
        const beganOnPrompt = pointerPrompt;
        pointerPrompt = null;
        // A keyboard response may have advanced the prompt while the mouse was held.
        if (beganOnPrompt !== null && beganOnPrompt !== promptVersion) return;
      }
      // Browsers report the second click of a double-click with detail = 2.
      if (event.detail > 1) return;
      if (event.detail === 0 ? !experimentConfig.enableKeyboard : !experimentConfig.enableMouse) return;
      recordRating(value);
    });
    ratingButtons.append(button);
  }

  document.addEventListener('keydown', (event) => {
    if (currentScreen !== 'rating') return;
    if (!experimentConfig.enableKeyboard || event.ctrlKey || event.altKey ||
        event.metaKey || event.isComposing) return;
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      // Suppress native button auto-repeat while allowing normal page scrolling.
      if (event.target instanceof HTMLButtonElement) event.preventDefault();
      return;
    }
    const value = Number(event.key);
    if (Number.isInteger(value) && value >= 1 && value <= 9) {
      event.preventDefault();
      if (!event.repeat) recordRating(value);
    }
  });

  studyImage.addEventListener('error', () => {
    if (currentScreen !== 'rating') return;
    clearImageLoadTimer();
    imageState = 'error';
    render();
  });

  studyImage.addEventListener('load', () => {
    if (currentScreen !== 'rating' || imageState !== 'loading') return;
    clearImageLoadTimer();
    imageState = studyImage.naturalWidth > 0 ? 'ready' : 'error';
    render();
  });

  retryImage.addEventListener('click', () => {
    if (currentScreen !== 'rating' || imageState !== 'error') return;
    // Cancel a stalled request before starting a fresh retry.
    studyImage.removeAttribute('src');
    imageRetryCount++;
    displayedImageIndex = -1;
    focusedRating = '';
    render();
  });

  // Read the current state and update the visible page to match it.
  const render = () => {
    ratingPanel.hidden = currentScreen !== 'rating';
    startButton.hidden = currentScreen === 'rating' || currentScreen === 'complete';
    statusMessage.textContent = '';
    retryImage.hidden = true;
    clearRatingTimer();
    cancelPromptPresentation();

    if (currentScreen === 'welcome') {
      screenDescription.textContent = `You will rate ${sessionImages.length} images for pleasantness and arousal.`;
      startButton.textContent = 'Start';
    } else if (currentScreen === 'instructions') {
      const inputInstructions = experimentConfig.enableMouse && experimentConfig.enableKeyboard
        ? 'Select a rating button or press a number key from 1 to 9. '
        : experimentConfig.enableKeyboard
          ? 'Use number keys 1 to 9, or Tab to a rating and press Enter or Space. '
          : 'Select a rating button using the mouse or touchscreen. ';
      screenDescription.textContent =
        'For each image, you will give two ratings on a scale from 1 to 9: ' +
        'one for valence (pleasantness) and one for arousal. ' + inputInstructions +
        'The final study instructions will be added once the study design is confirmed.';
      startButton.textContent = 'Begin';
    } else if (currentScreen === 'rating') {
      const image = sessionImages[currentImageIndex];
      if (displayedImageIndex !== currentImageIndex) {
        displayedImageIndex = currentImageIndex;
        imageState = 'loading';
        clearImageLoadTimer();
        imageLoadTimer = setTimeout(() => {
          imageLoadTimer = null;
          if (currentScreen !== 'rating' || imageState !== 'loading') return;
          imageState = 'error';
          render();
        }, 15_000);
        studyImage.alt = image.alt;
        // A distinct retry URL avoids reusing an in-flight or cached failure.
        if (imageRetryCount === 0) {
          studyImage.src = image.src;
        } else {
          const retryUrl = new URL(image.src, document.baseURI);
          retryUrl.searchParams.set('retry', String(imageRetryCount));
          studyImage.src = retryUrl.href;
        }
        // A cached image may already be available before its load event runs.
        if (studyImage.complete && studyImage.naturalWidth > 0) {
          imageState = 'ready';
          clearImageLoadTimer();
        }
      }
      screenDescription.textContent =
        `Image ${currentImageIndex + 1} of ${sessionImages.length}: select one ${currentDimension} rating below.`;

      if (currentDimension === 'valence') {
        ratingQuestion.textContent = ratingPrompts.valence.question;
        scaleLabels.textContent = `1 = ${ratingPrompts.valence.lowAnchor}; 9 = ${ratingPrompts.valence.highAnchor}`;
      } else {
        ratingQuestion.textContent = ratingPrompts.arousal.question;
        scaleLabels.textContent = `1 = ${ratingPrompts.arousal.lowAnchor}; 9 = ${ratingPrompts.arousal.highAnchor}`;
      }

      if (imageState === 'loading') {
        statusMessage.textContent = 'Loading image. Please wait before rating.';
      } else if (imageState === 'error') {
        statusMessage.textContent = 'This study image could not be loaded. Select Retry image to continue.';
        retryImage.hidden = false;
        retryImage.focus();
      } else if (currentDimension !== experimentConfig.ratingOrder[0]) {
        const previousDimension = experimentConfig.ratingOrder[0];
        statusMessage.textContent =
          `${previousDimension === 'valence' ? 'Valence' : 'Arousal'} recorded. Now rate ${currentDimension}.`;
      }

      for (const button of ratingButtons.querySelectorAll('button')) {
        button.disabled = true;
      }

      if (imageState === 'ready') {
        const version = promptVersion;
        // Focus and scroll before a paint; enable responses in the next callback
        // so the updated question/image has had a rendering opportunity.
        promptFrame = requestAnimationFrame(() => {
          const ratingKey = `${currentImageIndex}:${currentDimension}`;
          if (focusedRating !== ratingKey) {
            focusedRating = ratingKey;
            ratingQuestion.focus();
          }
          promptFrame = requestAnimationFrame(() => {
            promptFrame = null;
            if (currentScreen !== 'rating' || imageState !== 'ready' || version !== promptVersion) return;
            promptReady = true;
            for (const button of ratingButtons.querySelectorAll('button')) button.disabled = false;
            if (experimentConfig.timeLimitMs !== null) {
              ratingTimer = setTimeout(() => {
                statusMessage.textContent = 'Time limit reached. Please select a rating to continue.';
              }, experimentConfig.timeLimitMs);
            }
          });
        });
      }
    } else {
      clearImageLoadTimer();
      screenDescription.textContent = 'Development trials complete.';
      screenDescription.focus();
      statusMessage.textContent =
        responses.map((response) =>
          `${response.imageOrder}. ${response.imageId}: valence ${response.valence}, arousal ${response.arousal}.`
        ).join(' ') + ' ' +
        'These responses are only in memory and are not saved to a file. Refresh to try again.';
    }
  };

  startButton.addEventListener('click', (event) => {
    if (event.detail > 1) return;
    if (currentScreen === 'welcome') {
      currentScreen = 'instructions';
      render();
    } else if (currentScreen === 'instructions') {
      currentScreen = 'rating';
      render();
    }
  });

  startButton.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  });

  render();
  // Static HTML remains disabled if imports fail or initialization never runs.
  startButton.disabled = false;
} catch (error) {
  console.error(error);
  const startButton = document.querySelector<HTMLButtonElement>('#start-button');
  const ratingPanel = document.querySelector<HTMLElement>('#rating-panel');
  const statusMessage = document.querySelector<HTMLElement>('#status');
  const screenDescription = document.querySelector<HTMLElement>('#screen-description');
  if (startButton) startButton.disabled = true;
  if (ratingPanel) ratingPanel.hidden = true;
  if (screenDescription) screenDescription.textContent = 'Study unavailable.';
  if (statusMessage) {
    statusMessage.textContent = 'This study cannot start. Please contact the study administrator.';
  }
}
