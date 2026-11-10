export type CaptureMeta = { frameId: string; capturedCount: number };
export class Capture {
  stream?: MediaStream;
  video?: HTMLVideoElement;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  busy = false;
  paused = false;
  started = 0;
  chunks: Blob[] = [];
  bytes = 0;
  capturedCount = 0;
  onEnded?: () => void;
  private running = false;
  private stopped?: Promise<Blob | undefined>;
  private ended?: () => void;
  private controller = new AbortController();
  private lastSent = -Infinity;
  private latest?: { image: string; seconds: number; meta: CaptureMeta };
  get signal() {
    return this.controller.signal;
  }
  async request() {
    if (
      window.isSecureContext === false ||
      !navigator.mediaDevices?.getDisplayMedia
    )
      throw new Error(
        "Screen sharing requires a supported desktop browser on localhost or HTTPS.",
      );
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      if (this.controller.signal.aborted) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = undefined;
        throw new Error("Capture was cancelled");
      }
    } catch (error) {
      throw new Error(
        (error as DOMException).name === "NotAllowedError"
          ? "Screen-sharing permission was denied. Choose a window to start a session."
          : "Unable to share your screen. Try again in a supported browser.",
      );
    }
    this.ended = () => {
      this.running = false;
      clearInterval(this.timer);
      this.onEnded?.();
    };
    const track = this.stream.getVideoTracks()[0];
    if (!track || track.readyState === "ended") {
      this.stream.getTracks().forEach((item) => item.stop());
      this.stream = undefined;
      throw new Error(
        "The browser did not provide an active screen-sharing track.",
      );
    }
    track.addEventListener("ended", this.ended, { once: true });
    return this.stream;
  }
  async begin(
    interval: number,
    send: (image: string, seconds: number, meta: CaptureMeta) => Promise<void>,
    saveVideo: boolean,
    onError: (message: string) => void,
    options: {
      captureIntervalSeconds?: number;
      onCapture?: (count: number) => void;
    } = {},
  ) {
    if (!this.stream || this.stream.getVideoTracks()[0]?.readyState === "ended")
      throw new Error("Screen sharing ended before session initialization");
    this.started = Date.now();
    this.running = true;
    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    try {
      await this.video.play();
    } catch (error) {
      if (this.running) throw error;
      return;
    }
    if (!this.running) return;
    if (saveVideo && typeof MediaRecorder === "undefined")
      onError(
        "Local video recording is unavailable; frame coaching continues.",
      );
    if (saveVideo && typeof MediaRecorder !== "undefined") {
      try {
        this.recorder = new MediaRecorder(this.stream);
        this.recorder.ondataavailable = (e) => {
          if (saveVideo && e.data.size) {
            this.bytes += e.data.size;
            if (this.bytes > 100 * 1024 * 1024) {
              saveVideo = false;
              this.chunks = [];
              onError(
                "Local video exceeded 100 MB and was discarded; frame coaching continues.",
              );
            } else this.chunks.push(e.data);
          }
        };
        this.recorder.onerror = () =>
          onError("Local video recording failed; frame coaching continues.");
        this.recorder.start(1000);
        if (this.paused) this.recorder.pause();
      } catch {
        onError(
          "Video recording is unavailable. Screen frame analysis is still active.",
        );
      }
    }
    const tick = () => {
      if (!this.running || this.paused || !this.video?.videoWidth) return;
      try {
        const canvas = document.createElement("canvas"),
          scale = Math.min(
            1,
            1280 / this.video.videoWidth,
            1280 / this.video.videoHeight,
          );
        canvas.width = Math.max(1, Math.round(this.video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(this.video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Frame canvas is unavailable");
        context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        let image = canvas.toDataURL("image/jpeg", 0.7);
        if (image.length > 680000) image = canvas.toDataURL("image/jpeg", 0.4);
        canvas.width = canvas.height = 0;
        if (image.length > 680000)
          throw new Error("Frame too large; select a smaller window.");
        this.capturedCount++;
        options.onCapture?.(this.capturedCount);
        this.latest = {
          image,
          seconds: Math.floor((Date.now() - this.started) / 1000),
          meta: {
            frameId: crypto.randomUUID(),
            capturedCount: this.capturedCount,
          },
        };
      } catch (error) {
        onError((error as Error).message);
        return;
      }
      if (this.busy || Date.now() - this.lastSent < interval * 1000) return;
      const selected = this.latest;
      this.latest = undefined;
      this.busy = true;
      this.lastSent = Date.now();
      void (async () => {
        try {
          await send(selected.image, selected.seconds, selected.meta);
        } catch (error) {
          if (!this.controller.signal.aborted)
            onError((error as Error).message);
        } finally {
          this.busy = false;
        }
      })();
    };
    this.timer = setInterval(
      tick,
      Math.max(1, options.captureIntervalSeconds ?? 1) * 1000,
    );
    tick();
  }
  pause() {
    this.paused = !this.paused;
    this.latest = undefined;
    if (this.paused && this.recorder?.state === "recording")
      this.recorder.pause();
    else if (!this.paused && this.recorder?.state === "paused")
      this.recorder.resume();
    return this.paused;
  }
  cancel() {
    this.controller.abort();
    this.running = false;
    clearInterval(this.timer);
    this.latest = undefined;
    const stream = this.stream;
    this.stream = undefined;
    if (this.ended)
      stream?.getVideoTracks()[0]?.removeEventListener?.("ended", this.ended);
    stream?.getTracks().forEach((track) => track.stop());
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = undefined;
    }
  }
  stop(): Promise<Blob | undefined> {
    if (this.stopped) return this.stopped;
    this.onEnded = undefined;
    const recorder = this.recorder;
    const flush =
      recorder && recorder.state !== "inactive"
        ? new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(finish, 1500);
            recorder.onstop = finish;
            try {
              recorder.stop();
            } catch {
              finish();
            }
          })
        : Promise.resolve();
    this.cancel();
    this.stopped = (async () => {
      await flush;
      const blob = this.chunks.length
        ? new Blob(this.chunks, {
            type: recorder?.mimeType || "video/webm",
          })
        : undefined;
      this.chunks = [];
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
      }
      return blob;
    })();
    return this.stopped;
  }
}
