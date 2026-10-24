import plateUrl from './assets/images/official/plate.png';
import stoolUrl from './assets/images/official/stool.png';
import hammerUrl from './assets/images/official/hammer.png';
import chairUrl from './assets/images/official/chair.png';
import chatgptUrl from './assets/images/official/chatgpt.png';
import claudeUrl from './assets/images/official/claude.png';
import geminiUrl from './assets/images/official/gemini.png';
import copilotUrl from './assets/images/official/copilot.png';

type StudyImage = {
  id: string;
  src: string;
  alt: string;
};

// Official study images. The session decides their presentation order.
export const images: StudyImage[] = [
  { id: 'plate', src: plateUrl, alt: 'A plate' },
  { id: 'stool', src: stoolUrl, alt: 'A stool' },
  { id: 'hammer', src: hammerUrl, alt: 'A hammer' },
  { id: 'chair', src: chairUrl, alt: 'A chair' },
  { id: 'chatgpt', src: chatgptUrl, alt: 'ChatGPT logo' },
  { id: 'claude', src: claudeUrl, alt: 'Claude logo' },
  { id: 'gemini', src: geminiUrl, alt: 'Google Gemini logo' },
  { id: 'copilot', src: copilotUrl, alt: 'Microsoft Copilot logo' },
];
