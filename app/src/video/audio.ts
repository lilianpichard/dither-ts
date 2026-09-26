// Honest report on whether this runtime could capture a video's audio at all.
// The MP4 and GIF writers are video-only, so nothing here claims audio is
// preserved: the probe explains whether the capture APIs exist so the UI can
// say why the output is silent. Pure over an injected environment, no DOM.

export interface AudioCapabilityEnv {
  AudioEncoder?: unknown;
  /** Chromium and Electron expose captureStream on HTMLMediaElement. */
  captureStream?: unknown;
}

export interface AudioCapability {
  /** Every capture API needed to pull an audio track out of a video element. */
  supported: boolean;
  /** Human-readable names of the missing APIs, empty when supported. */
  missing: string[];
}

/** The environment as seen from a browser window, or empty when there is none. */
export function browserAudioEnv(): AudioCapabilityEnv {
  if (typeof window === "undefined") return {};
  // captureStream is Chromium-only, so it is absent from the DOM lib types.
  const media = window.HTMLMediaElement?.prototype as
    (HTMLMediaElement & { captureStream?: unknown }) | undefined;
  return {
    AudioEncoder: (window as { AudioEncoder?: unknown }).AudioEncoder,
    captureStream: media?.captureStream,
  };
}

function present(value: unknown): boolean {
  return typeof value === "function";
}

export function probeAudioCapture(env: AudioCapabilityEnv = browserAudioEnv()): AudioCapability {
  // getUserMedia is deliberately not required: it opens input devices, and
  // this app would only read a track off the video element it already holds.
  const missing: string[] = [];
  if (!present(env.AudioEncoder)) missing.push("AudioEncoder");
  if (!present(env.captureStream)) missing.push("media capture stream");
  return { supported: missing.length === 0, missing };
}

/**
 * One line stating what the export actually contains. Never implies audio
 * survives, because the writers never mux an audio track.
 */
export function describeAudioStatus(capability: AudioCapability): string {
  const output = "Video-only export: MP4 and GIF drop the source audio.";
  if (capability.supported)
    return `${output} Capture APIs are present, but no audio track is muxed.`;
  return `${output} Audio capture unavailable here (missing ${capability.missing.join(", ")}).`;
}
