"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

/**
 * Reading a barcode with the phone's own camera.
 *
 * The till was built around a USB scanner, which is a keyboard that types very
 * fast and presses Enter. On a phone there is no such thing, and typing a
 * fifteen-digit GS1 code off a box at the counter is not a workflow. So the
 * camera becomes the scanner, and it feeds the same search field: whatever it
 * reads is handed to `findForSale` exactly as a hardware scan would be, GS1
 * payload and all, so lot and expiry parsing is unchanged.
 *
 * `BarcodeDetector` is the browser's own decoder -- present in Chrome on
 * Android, which is what this pharmacy's phones run. There is no bundled
 * fallback decoder: a second-rate one reading drug packaging wrongly is worse
 * than no camera at all, and the keyboard is always still there. When the API
 * is missing the button does not appear, rather than appearing and failing.
 *
 * The stream is stopped on every exit path -- a match, a close, an error, an
 * unmount. A camera light left on after the customer has gone is the kind of
 * thing that gets an app uninstalled.
 */

/** Not in TypeScript's DOM library yet; this is the part of it actually used. */
type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/**
 * The linear symbologies actually printed on medicine boxes, plus the 2D codes
 * Indonesian packaging is starting to carry. Naming them narrows what the
 * decoder has to try, which makes it both faster and less prone to reading a
 * label border as a code.
 */
const FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "qr_code",
  "data_matrix",
];

/** Nothing can turn a decoder on or off mid-session, so there is nothing to watch. */
function subscribeNever() {
  return () => {};
}

/**
 * What this browser can and cannot do, as three separate facts.
 *
 * Kept apart rather than reduced to one boolean because they fail for
 * different reasons and have different answers: an insecure page is a
 * deployment problem the owner can fix, and a missing decoder is a device that
 * will never scan. A single "no" told the person neither.
 */
export type ScanSupport = {
  /** https, or localhost. Browsers refuse the camera to anything else. */
  secure: boolean;
  /** The camera API itself, which is also absent on an insecure page. */
  camera: boolean;
  /** The browser's own barcode decoder. */
  decoder: boolean;
};

function scanSupport(): ScanSupport {
  if (typeof window === "undefined") {
    return { secure: false, camera: false, decoder: false };
  }
  return {
    secure: window.isSecureContext,
    camera: !!navigator.mediaDevices?.getUserMedia,
    decoder: detectorCtor() !== null,
  };
}

/**
 * A stable snapshot. `useSyncExternalStore` compares the value it gets with the
 * last one by identity, so returning a fresh object each call would loop
 * forever. None of these three can change within a page's life.
 */
let supportSnapshot: ScanSupport | null = null;
function cachedScanSupport(): ScanSupport {
  supportSnapshot ??= scanSupport();
  return supportSnapshot;
}

const SERVER_SUPPORT: ScanSupport = { secure: false, camera: false, decoder: false };

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

export function ScanButton({
  onScan,
  className = "",
}: {
  /** Called with the raw payload, exactly as a hardware scanner would type it. */
  onScan: (code: string) => void;
  className?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  // Browser capabilities, read the way React wants them read: the server
  // snapshot says "nothing works", so the button is inert in the HTML and
  // settles on hydration with no mismatch and no render loop. Nothing can
  // change any of them afterwards, so there is nothing to subscribe to.
  const support = useSyncExternalStore(
    subscribeNever,
    cachedScanSupport,
    () => SERVER_SUPPORT,
  );

  // The button stays, and says why when it cannot scan.
  //
  // It used to hide itself, which was worse: on a phone the till is *meant* to
  // be scanned with, and a missing button is indistinguishable from a missing
  // feature. Nobody can act on that. "The camera needs https" is something the
  // owner can actually do something about.
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center justify-center gap-2 rounded-lg border border-rule px-3 py-2.5 text-sm text-muted hover:border-accent hover:text-accent ${className}`}
      >
        <CameraIcon />
        {t("sell.scanCamera")}
      </button>

      {open && (
        <ScannerOverlay
          support={support}
          onClose={() => setOpen(false)}
          onScan={(code) => {
            setOpen(false);
            onScan(code);
          }}
        />
      )}
    </>
  );
}

function ScannerOverlay({
  support,
  onScan,
  onClose,
}: {
  support: ScanSupport;
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref rather than state: the detection loop must see the current
  // value without being torn down and restarted on every frame.
  const doneRef = useRef(false);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const stop = () => {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    (async () => {
      // Named in the order somebody would fix them: an insecure page is why
      // the camera API is missing, so it is reported first and on its own.
      if (!support.secure) {
        setError("sell.scanInsecure");
        return;
      }
      if (!support.camera) {
        setError("sell.scanNoCamera");
        return;
      }

      const Detector = detectorCtor();
      if (!Detector) {
        setError("sell.scanUnsupported");
        return;
      }

      try {
        // The back camera, and a resolution high enough that the bars of an
        // EAN-13 survive: at 640px wide they blur into each other.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stop();
          return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = new Detector({ formats: FORMATS });

        timer = setInterval(async () => {
          if (doneRef.current || !videoRef.current || videoRef.current.readyState < 2) {
            return;
          }
          try {
            const found = await detector.detect(videoRef.current);
            const code = found[0]?.rawValue?.trim();
            if (!code) return;

            // One read ends the scan. Without the guard the interval fires
            // again while the first result is still being handled and the same
            // box is added twice.
            doneRef.current = true;
            stop();
            onScanRef.current(code);
          } catch {
            // A frame that cannot be decoded is the normal case, not an error:
            // most frames have no barcode in them at all.
          }
        }, 250);
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : "";
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "sell.scanDenied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "sell.scanNoCamera"
              : "sell.scanFailed",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // The support flags are read once per page and cannot change, so listing
    // them would not make this effect re-run; it is listed for the linter's
    // benefit and to say plainly that the camera is started exactly once.
  }, [support.secure, support.camera]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("sell.scanCamera")}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
    >
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3">
        <div className="flex items-center justify-between text-white">
          <span className="font-medium">{t("sell.scanCamera")}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            {t("common.cancel")}
          </button>
        </div>

        {error ? (
          <div className="rounded-lg bg-surface p-4 text-sm">
            <p>{t(error)}</p>
            <p className="mt-2 text-xs text-muted">{t("sell.scanTypeInstead")}</p>
            {/* The three facts behind the refusal, in plain sight. Somebody
                trying to get this working on a particular phone can read them
                out; without them the only report possible is "it does not
                work", which no one can act on. */}
            <p className="mt-3 font-mono text-xs text-faint">
              {t("sell.scanDiagnosis", {
                secure: t(support.secure ? "common.yes" : "common.no"),
                camera: t(support.camera ? "common.yes" : "common.no"),
                decoder: t(support.decoder ? "common.yes" : "common.no"),
              })}
            </p>
          </div>
        ) : (
          <>
            <div className="relative flex-1 overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full object-cover"
              />
              {/* An aiming window, so the code is held where the decoder is
                  actually looking rather than anywhere in frame. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-6 top-1/2 h-28 -translate-y-1/2 rounded-lg border-2 border-white/80"
              />
            </div>
            <p className="text-center text-sm text-white/80">{t("sell.scanAim")}</p>
          </>
        )}
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1.5 1.5 0 0 0 1.3-.75l.7-1.2A1.5 1.5 0 0 1 10 4.3h4a1.5 1.5 0 0 1 1.3.75l.7 1.2A1.5 1.5 0 0 0 17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
