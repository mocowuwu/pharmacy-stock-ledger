import { useEffect, useRef, useState } from "react";
import { useApp } from "./context";
import { Icon } from "./icons";

/**
 * The camera as a barcode scanner, for the offline till.
 *
 * Same rule as the website's ScanButton: the browser's own BarcodeDetector,
 * no bundled decoder -- one that misreads drug packaging is worse than none.
 * What it reads goes to the same handler the keyboard feeds, so a code from
 * the camera resolves exactly as one from a USB scanner would.
 */

type Detector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
type DetectorClass = new (opts: { formats: string[] }) => Detector;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "data_matrix", "qr_code"];

/** Why the camera cannot scan here, or null when it can. */
export function scanUnavailable(): "camera" | "decoder" | null {
  if (!navigator.mediaDevices?.getUserMedia) return "camera";
  if (!("BarcodeDetector" in window)) return "decoder";
  return null;
}

export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const { t } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The camera starts once per opening; a new handler from a re-render must
  // not restart it.
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector: DetectorClass }).BarcodeDetector;
        const detector = new Detector({ formats: FORMATS });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();

        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const code = found.find((f) => f.rawValue.trim())?.rawValue;
            if (code) {
              handler.current(code);
              return;
            }
          } catch {
            // A frame that could not be read; try the next one.
          }
          timer = setTimeout(() => void tick(), 120);
        };
        void tick();
      } catch {
        setProblem(t("scan.denied"));
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [t]);

  return (
    <div className="scanner" role="dialog" aria-label={t("scan.title")}>
      <video ref={video} playsInline muted />
      <div className="frame" />
      <div className="caption">{problem ?? t("scan.hint")}</div>
      <button className="icon-btn close" onClick={onClose} aria-label={t("common.close")}>
        <Icon name="close" size={24} />
      </button>
    </div>
  );
}
