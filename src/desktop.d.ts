type DesktopResult<T> = { ok: true; value: T } | { ok: false; message: string; code?: string };
interface Window {
  ainogoDesktop?: {
    listKeys(): DesktopResult<string[]>;
    getItem(key: string): DesktopResult<string | null>;
    setItem(key: string, raw: string): DesktopResult<void>;
    info(): DesktopResult<{ directory: string; notices: string[] }>;
    exportCsv(raw: string): Promise<DesktopResult<{ canceled: boolean }>>;
    openFolder(): Promise<DesktopResult<void>>;
  };
}
