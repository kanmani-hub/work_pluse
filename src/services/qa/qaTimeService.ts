export class QaTimeService {
  private isQaMode = import.meta.env.VITE_QA_FAST_MODE === 'true';
  private multiplier = 1;
  private baseRealTime = Date.now();
  private baseSimTime = Date.now();

  get isEnabled() {
    return this.isQaMode;
  }

  now(): number {
    if (!this.isQaMode) return Date.now();
    const realElapsed = Date.now() - this.baseRealTime;
    return this.baseSimTime + (realElapsed * this.multiplier);
  }
  
  getDate(): Date {
    return new Date(this.now());
  }
  
  getIsoString(): string {
    return this.getDate().toISOString();
  }

  setMultiplier(m: number) {
    if (!this.isQaMode) return;
    this.baseSimTime = this.now();
    this.baseRealTime = Date.now();
    this.multiplier = m;
  }

  getMultiplier(): number {
    return this.multiplier;
  }

  advanceTime(minutes: number) {
    if (!this.isQaMode) return;
    this.baseSimTime += minutes * 60000;
  }
  
  reset() {
    this.baseRealTime = Date.now();
    this.baseSimTime = Date.now();
    this.multiplier = 1;
  }

  getRealToSimulatedInterval(realMs: number): number {
      if (!this.isQaMode || this.multiplier === 0) return realMs;
      return realMs / this.multiplier;
  }
}

export const qaTimeService = new QaTimeService();
