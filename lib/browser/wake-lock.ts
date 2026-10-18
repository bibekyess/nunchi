/** Keeps the screen on while listening. Browsers drop the lock when the page is hidden. */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  async acquire() {
    this.wanted = true;
    await this.request();
  }

  async release() {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    await s?.release().catch(() => {});
  }

  dispose() {
    void this.release();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private async request() {
    if (!this.supported || this.sentinel || document.visibilityState !== 'visible') return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      // Denied (battery saver, unsupported context). Listening still works.
    }
  }

  private onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.request();
  };
}
