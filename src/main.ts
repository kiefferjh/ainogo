import './style.css';
import { images } from './images';
import { experimentConfig, ratingPrompts } from './config';
import { parseSession, readSessions, saveSession, sessionCsv, sessionStoragePrefix, SessionConflictError, type StudySession, type InputMethod, type SessionStorage } from './session';

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
  const desktop = window.ainogoDesktop;
  const desktopValue = <T>(result: DesktopResult<T>): T => {
    if (!result.ok) {
      if (result.code === 'SESSION_CONFLICT') throw new SessionConflictError(result.message);
      throw new Error(result.message);
    }
    return result.value;
  };
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

  let sessionImages = experimentConfig.randomizeImageOrder ? shuffle(images) : [...images];
  const signatureImages = desktop ? images.map(image => ({ id: image.id, alt: image.alt,
    filename: new URL(image.src, document.baseURI).pathname.split('/').pop() })) : images;
  const studySignature = JSON.stringify({ images: signatureImages, experimentConfig, ratingPrompts });
  let session: StudySession = {
    schemaVersion: 1, sessionId, startedAt: new Date().toISOString(), completedAt: null,
    studySignature, imageIds: sessionImages.map(image => image.id),
    settings: { ...experimentConfig, ratingOrder: [...experimentConfig.ratingOrder] },
    responses: [], pendingInterrupted: false, revision: 0,
  };
  let sessionStarted = false;
  let unsavedPreview = false;
  let storage: SessionStorage | null = null;
  let savedSessions: StudySession[] = [];
  let sessionConflict = false;
  let collectionUnavailable = false;
  let paused = false;
  let promptStartedAt: number | null = null;

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
  const previewButton = document.querySelector<HTMLButtonElement>('#preview-button');
  const screenDescription = document.querySelector<HTMLParagraphElement>('#screen-description');
  const statusMessage = document.querySelector<HTMLParagraphElement>('#status');
  const ratingPanel = document.querySelector<HTMLElement>('#rating-panel');
  const studyImage = document.querySelector<HTMLImageElement>('#study-image');
  const ratingButtons = document.querySelector<HTMLDivElement>('#rating-buttons');
  const ratingQuestion = document.querySelector<HTMLHeadingElement>('#rating-question');
  const scaleLabels = document.querySelector<HTMLParagraphElement>('#scale-labels');
  const retryImage = document.querySelector<HTMLButtonElement>('#retry-image');
  const downloadSession = document.querySelector<HTMLButtonElement>('#download-session');
  const sessionExportNote = document.querySelector<HTMLElement>('#session-export-note');
  const newSession = document.querySelector<HTMLButtonElement>('#new-session');
  const savedSection = document.querySelector<HTMLElement>('#saved-sessions');
  const sessionSelect = document.querySelector<HTMLSelectElement>('#session-select');
  const resumeSession = document.querySelector<HTMLButtonElement>('#resume-session');
  const downloadSaved = document.querySelector<HTMLButtonElement>('#download-saved');
  const storageStatus = document.querySelector<HTMLElement>('#storage-status');
  const sessionInfo = document.querySelector<HTMLElement>('#session-info');

  if (!startButton || !screenDescription || !statusMessage || !ratingPanel || !studyImage || !ratingButtons || !ratingQuestion || !scaleLabels || !retryImage || !downloadSession || !newSession || !savedSection || !sessionSelect || !resumeSession || !downloadSaved || !storageStatus || !sessionInfo) {
    throw new Error('The page is missing a required screen element.');
  }

  studyImage.hidden = !experimentConfig.showImageDuringRating;

  const storageWarning = () => {
    storageStatus.textContent = desktop
      ? 'File saving is unavailable. Export your session CSV before closing; recent responses may otherwise be lost.'
      : 'Browser saving is unavailable. Download your session CSV before closing or refreshing; recent responses may otherwise be lost.';
  };
  const canResume = (saved: StudySession) => saved.completedAt === null && saved.studySignature === studySignature &&
    saved.imageIds.length === images.length && saved.imageIds.every(id => images.some(image => image.id === id));
  const selectedSession = () => savedSessions.find(saved => saved.sessionId === sessionSelect.value);
  const updateSavedButtons = () => {
    const saved = selectedSession();
    resumeSession.disabled = !saved || !canResume(saved);
    downloadSaved.disabled = !saved || saved.responses.length === 0;
  };
  const desktopStorageMessage = () => {
    if (!desktop) return;
    const info = desktopValue(desktop.info());
    collectionUnavailable = !!info.collectionError;
    storageStatus.textContent = info.collectionError ||
      `All experiments, including partially completed tests, are saved after each response as JSON, CSV and Excel (${info.collection?.sessionCount ?? 0} sessions). Select Open data folder for all sessions. CSV export buttons export only one session. Individual session files: ${info.directory}. ${info.notices.join(' ')}`;
  };
  try {
    storage = desktop ? {
      get length() { return desktopValue(desktop.listKeys()).length; },
      key(index: number) { return desktopValue(desktop.listKeys())[index] ?? null; },
      getItem(key: string) { return desktopValue(desktop.getItem(key)); },
      setItem(key: string, value: string) { desktopValue(desktop.setItem(key, value)); },
    } : localStorage;
    const result = readSessions(storage);
    savedSessions = result.sessions;
    if (desktop) {
      desktopStorageMessage();
      if (result.damaged) storageStatus.textContent += ' Some damaged records could not be read and were preserved.';
    } else {
      storageStatus.textContent = result.damaged
        ? 'Some damaged saved sessions could not be read. Valid sessions are listed below.'
        : 'Browser-saving mode saves each response here, including partial tests. CSV downloads contain only the selected session. The online preview is not saved.';
    }
  } catch {
    storage = null;
    storageWarning();
  }
  for (const saved of savedSessions) {
    const option = document.createElement('option');
    option.value = saved.sessionId;
    option.textContent = `${saved.startedAt} — ${saved.sessionId} — ${saved.completedAt ? 'complete' : `${saved.responses.length}/${saved.imageIds.length * 2} ratings`}`;
    sessionSelect.append(option);
  }
  updateSavedButtons();
  sessionSelect.addEventListener('change', updateSavedButtons);

  const saveCurrentSession = () => {
    if (unsavedPreview || !storage || sessionConflict) return;
    try {
      saveSession(storage, session);
      desktopStorageMessage();
    } catch (error) {
      if (error instanceof SessionConflictError) {
        sessionConflict = true;
        storageStatus.textContent = 'This session changed in another tab. Responses are paused to avoid overwriting it. Download your current CSV, then start a new session.';
      } else {
        storage = null;
        storageWarning();
      }
    }
  };

  const downloadCsv = async (saved: StudySession) => {
    if (desktop) {
      try {
        const result = desktopValue(await desktop.exportCsv(JSON.stringify(saved)));
        if (!result.canceled) statusMessage.textContent = `CSV exported for session ${saved.sessionId} only.`;
      } catch (error) {
        storageStatus.textContent = `CSV export failed: ${error instanceof Error ? error.message : 'Please try again.'}`;
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([sessionCsv(saved)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ainogo-${saved.sessionId}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  downloadSession.addEventListener('click', () => {
    if (!unsavedPreview && session.responses.length && (session.completedAt || !storage || sessionConflict)) downloadCsv(session);
  });
  downloadSaved.addEventListener('click', () => {
    const saved = selectedSession();
    if (saved?.responses.length) downloadCsv(saved);
  });
  newSession.addEventListener('click', () => window.location.reload());
  if (desktop) {
    downloadSession.textContent = 'Export CSV — this session only';
    downloadSaved.textContent = 'Export CSV — selected session only';
    document.querySelector('#saved-sessions-heading')!.textContent = 'Sessions saved on this computer';
    const folderButton = document.querySelector<HTMLButtonElement>('#open-data-folder');
    if (folderButton) {
      folderButton.hidden = false;
      folderButton.addEventListener('click', async () => {
        try { desktopValue(await desktop.openFolder()); }
        catch { storageStatus.textContent = 'Could not open the data folder. Its location is shown above.'; }
      });
    }
    const downloadLink = document.querySelector<HTMLElement>('#desktop-download');
    if (downloadLink) downloadLink.hidden = true;
  }

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
    promptStartedAt = null;
  };

  const recordRating = (value: number, inputMethod: InputMethod) => {
    const receivedAt = performance.now();
    if (currentScreen !== 'rating' || imageState !== 'ready' || !promptReady ||
        paused || sessionConflict || promptStartedAt === null ||
        !Number.isInteger(value) || value < 1 || value > 9 || ratings[currentDimension] !== null) return;

    const reactionTimeMs = Math.max(0, receivedAt - promptStartedAt);
    const image = sessionImages[currentImageIndex];
    session.responses.push({
      imageId: image.id,
      imageFilename: new URL(image.src, document.baseURI).pathname.split('/').pop() || image.id,
      imageOrder: currentImageIndex + 1, dimension: currentDimension,
      ratingPosition: experimentConfig.ratingOrder.indexOf(currentDimension) + 1,
      value, reactionTimeMs, inputMethod, respondedAt: new Date().toISOString(),
      exceededTimeLimit: experimentConfig.timeLimitMs !== null && reactionTimeMs >= experimentConfig.timeLimitMs,
      interrupted: session.pendingInterrupted,
    });
    session.pendingInterrupted = false;
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
        sessionId: session.sessionId,
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
        session.completedAt = new Date().toISOString();
        clearRatingTimer();
      }
    }

    saveCurrentSession();
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
      const directPointer = event.pointerType === 'touch' || event.pointerType === 'pen';
      const pointerActivation = directPointer || event.detail > 0;
      if (pointerActivation) {
        const beganOnPrompt = pointerPrompt;
        pointerPrompt = null;
        // A keyboard response may have advanced the prompt while the mouse was held.
        if (beganOnPrompt !== null && beganOnPrompt !== promptVersion) return;
      }
      // Touch click counts may continue across intentional taps on new prompts.
      // Only mouse multi-clicks use this additional accidental-input guard.
      if (event.detail > 1 && !directPointer) return;
      if (pointerActivation ? !experimentConfig.enableMouse : !experimentConfig.enableKeyboard) return;
      recordRating(value, pointerActivation ? (event.pointerType === 'touch' ? 'touch' : event.pointerType === 'pen' ? 'pen' : 'mouse') : 'keyboard');
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
      if (!event.repeat) recordRating(value, 'keyboard');
    }
  });

  studyImage.addEventListener('error', () => {
    if (currentScreen !== 'rating') return;
    session.pendingInterrupted = true;
    saveCurrentSession();
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
    const onlineTest = document.querySelector<HTMLElement>('#online-test');
    if (onlineTest) onlineTest.hidden = !!desktop || currentScreen !== 'welcome';
    const browserOptions = document.querySelector<HTMLDetailsElement>('#browser-save-options');
    if (browserOptions) {
      browserOptions.hidden = currentScreen === 'rating' || currentScreen === 'complete';
      if (desktop || currentScreen === 'instructions') browserOptions.open = true;
    }
    for (const id of ['browser-save-summary', 'browser-save-description']) {
      const element = document.querySelector<HTMLElement>(`#${id}`);
      if (element) element.hidden = !!desktop || currentScreen !== 'welcome';
    }
    const desktopDownload = document.querySelector<HTMLElement>('#desktop-download');
    if (desktopDownload) desktopDownload.hidden = !!desktop || (currentScreen !== 'welcome' && currentScreen !== 'complete');
    ratingPanel.hidden = currentScreen !== 'rating';
    startButton.hidden = currentScreen === 'rating' || currentScreen === 'complete';
    statusMessage.textContent = '';
    retryImage.hidden = true;
    clearRatingTimer();
    cancelPromptPresentation();
    downloadSession.hidden = unsavedPreview || session.responses.length === 0 ||
      (currentScreen !== 'complete' && storage !== null && !sessionConflict);
    if (sessionExportNote) {
      sessionExportNote.hidden = downloadSession.hidden;
      sessionExportNote.textContent = 'This CSV contains only this session’s ratings and reaction times.' +
        (desktop ? ' For all saved experiments, including partial tests, select Open data folder.' : ' Other sessions are saved and exported separately.');
    }
    newSession.hidden = currentScreen !== 'complete' && !sessionConflict;
    newSession.textContent = unsavedPreview ? 'New session' : 'Next participant';
    savedSection.hidden = currentScreen !== 'welcome' || savedSessions.length === 0;
    sessionInfo.textContent = sessionStarted ? `Session: ${session.sessionId} — ${session.responses.length}/${sessionImages.length * 2} ratings recorded` : '';
    if (unsavedPreview) storageStatus.textContent = 'Online test — not saved. Ratings and reaction times stay in memory only and disappear when you close or refresh this page.';

    if (currentScreen === 'welcome') {
      screenDescription.textContent = `You will rate ${sessionImages.length} images for pleasantness and arousal.`;
      if (desktop) screenDescription.textContent += ' Start begins a new participant with a unique session ID. Resume session continues an interrupted test with its existing ID.';
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
        (unsavedPreview
          ? 'This is an unsaved online test. Ratings and reaction times are held in memory only; closing or refreshing discards them. '
          : `Each accepted response and its reaction time are saved ${desktop ? 'to this computer' : 'in this browser'}, even if you stop before finishing. CSV export contains only this session. `) +
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

      if (sessionConflict) {
        statusMessage.textContent = 'This session changed in another tab. Download your CSV and start a new session.';
      } else if (paused) {
        statusMessage.textContent = 'Study paused. Return to this tab/window to continue; the current rating will be marked interrupted.';
      } else if (imageState === 'ready') {
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
            if (currentScreen !== 'rating' || imageState !== 'ready' || version !== promptVersion || paused || sessionConflict) return;
            promptStartedAt = performance.now();
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
        (unsavedPreview ? ' Online test complete. These results were not saved. Closing or refreshing this page discards them. Download the desktop app to save future sessions.'
          : desktop ? (storage === null
            ? ' Saving failed. Export this participant’s CSV before closing or starting the next participant.'
            : collectionUnavailable
              ? ' This participant’s session file is saved, but the combined files need recovery. See the saving warning below before continuing.'
              : ' This participant’s session is saved. The combined JSON, CSV and Excel files include all saved experiments. Select Next participant for a new, unique session ID.')
          : ' Download your session CSV to keep the ratings and reaction times. Saved sessions remain on this browser unless its data is cleared.');
    }
  };

  previewButton?.addEventListener('click', () => {
    if (desktop || currentScreen !== 'welcome') return;
    unsavedPreview = true;
    currentScreen = 'instructions';
    render();
    screenDescription.focus();
  });

  startButton.addEventListener('click', (event) => {
    if (event.detail > 1) return;
    if (currentScreen === 'welcome') {
      currentScreen = 'instructions';
      render();
    } else if (currentScreen === 'instructions') {
      sessionStarted = true;
      session.startedAt = new Date().toISOString();
      saveCurrentSession();
      currentScreen = 'rating';
      render();
    }
  });

  resumeSession.addEventListener('click', () => {
    if (currentScreen !== 'welcome' || !storage) return;
    let saved: StudySession | null;
    try {
      saved = parseSession(storage.getItem(sessionStoragePrefix + sessionSelect.value) ?? '');
    } catch {
      storage = null;
      storageWarning();
      resumeSession.disabled = true;
      return;
    }
    if (!saved || !canResume(saved)) {
      storageStatus.textContent = 'This saved session cannot be resumed with the current study. You can still download valid saved responses.';
      return;
    }
    session = saved;
    sessionStarted = true;
    session.pendingInterrupted = true;
    sessionImages = session.imageIds.map(id => images.find(image => image.id === id)!);
    currentImageIndex = Math.floor(session.responses.length / 2);
    currentDimension = experimentConfig.ratingOrder[session.responses.length % 2];
    ratings.valence = null;
    ratings.arousal = null;
    if (session.responses.length % 2) {
      const previous = session.responses[session.responses.length - 1];
      ratings[previous.dimension] = previous.value;
    }
    for (let index = 0; index + 1 < session.responses.length; index += 2) {
      const pair = session.responses.slice(index, index + 2);
      responses.push({ sessionId: session.sessionId, imageId: pair[0].imageId, imageOrder: pair[0].imageOrder,
        valence: pair.find(row => row.dimension === 'valence')!.value,
        arousal: pair.find(row => row.dimension === 'arousal')!.value });
    }
    saveCurrentSession();
    currentScreen = 'rating';
    render();
  });

  const pauseSession = () => {
    if (currentScreen !== 'rating' || paused) return;
    paused = true;
    session.pendingInterrupted = true;
    saveCurrentSession();
    render();
  };
  const continueSession = () => {
    if (currentScreen !== 'rating' || !paused || document.visibilityState === 'hidden') return;
    paused = false;
    render();
  };
  window.addEventListener('blur', pauseSession);
  window.addEventListener('focus', continueSession);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pauseSession();
    else continueSession();
  });
  window.addEventListener('storage', event => {
    if (unsavedPreview || !sessionStarted || (event.key !== null && event.key !== sessionStoragePrefix + session.sessionId)) return;
    const other = event.newValue === null ? null : parseSession(event.newValue);
    if (!other || JSON.stringify(other) !== JSON.stringify(session)) {
      sessionConflict = true;
      storageStatus.textContent = 'This session changed in another tab. Download your current CSV before starting a new session.';
      render();
    }
  });

  startButton.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  });

  render();
  // Static HTML remains disabled if imports fail or initialization never runs.
  startButton.disabled = false;
  if (previewButton) previewButton.disabled = false;
} catch (error) {
  console.error(error);
  const startButton = document.querySelector<HTMLButtonElement>('#start-button');
  const ratingPanel = document.querySelector<HTMLElement>('#rating-panel');
  const statusMessage = document.querySelector<HTMLElement>('#status');
  const screenDescription = document.querySelector<HTMLElement>('#screen-description');
  if (startButton) startButton.disabled = true;
  const previewButton = document.querySelector<HTMLButtonElement>('#preview-button');
  if (previewButton) previewButton.disabled = true;
  if (ratingPanel) ratingPanel.hidden = true;
  if (screenDescription) screenDescription.textContent = 'Study unavailable.';
  if (statusMessage) {
    statusMessage.textContent = 'This study cannot start. Please contact the study administrator.';
  }
}
