import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, ScanText, Download } from "lucide-react";
import Tesseract from "tesseract.js";

const MAX_IMAGE_DIMENSION = 1600;

function getScaledSize(w: number, h: number, max = MAX_IMAGE_DIMENSION) {
  if (w <= max && h <= max) return { w, h };
  if (w > h) return { w: max, h: Math.round((h * max) / w) };
  return { w: Math.round((w * max) / h), h: max };
}

const Index: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [imageURL, setImageURL] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [blurredCount, setBlurredCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setImageURL(url);
    setBlurredCount(0);
    setProgress(0);
  }, []);

  const anonymize = useCallback(async () => {
    if (!imgRef.current) {
      toast.error("Please choose an image first");
      return;
    }
    try {
      setProcessing(true);
      setBlurredCount(0);
      setProgress(0);
      toast("Running OCR to find sensitive info...");

      // Prepare canvas with scaled image
      const img = imgRef.current;
      const { w, h } = getScaledSize(img.naturalWidth, img.naturalHeight);
      const canvas = canvasRef.current!;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/png");

      const result = await Tesseract.recognize(dataUrl, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text" && m.progress) {
            setProgress(Math.round(m.progress * 100));
          }
        },
      } as any);

      const words: any[] = (result?.data as any)?.words || [];
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
      const phoneRegex = /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/;

      type Rect = { x: number; y: number; w: number; h: number };
      const rects: Rect[] = [];

      const addRect = (bbox: any) => {
        if (!bbox) return;
        const x = Math.max(0, Math.min(bbox.x0, bbox.x1));
        const y = Math.max(0, Math.min(bbox.y0, bbox.y1));
        const wR = Math.abs(bbox.x1 - bbox.x0);
        const hR = Math.abs(bbox.y1 - bbox.y0);
        if (wR > 2 && hR > 2) rects.push({ x, y, w: wR, h: hR });
      };

      // Slide over words to find emails/phones
      for (let i = 0; i < words.length; i++) {
        const wItem = words[i];
        const token = (wItem?.text || "").trim();
        if (!token) continue;

        // Email as single token in most cases
        if (emailRegex.test(token)) {
          addRect(wItem?.bbox);
          continue;
        }

        // Try phone across a small window of tokens
        let combined = token;
        let consumedEnd = i;
        for (let j = i + 1; j < Math.min(words.length, i + 6); j++) {
          combined += " " + (words[j]?.text || "").trim();
          if (phoneRegex.test(combined)) {
            consumedEnd = j;
            break;
          }
        }
        if (consumedEnd > i) {
          // Union bbox from i..consumedEnd
          const slice = words.slice(i, consumedEnd + 1);
          const xs = slice.map((w: any) => [w?.bbox?.x0, w?.bbox?.x1]).flat();
          const ys = slice.map((w: any) => [w?.bbox?.y0, w?.bbox?.y1]).flat();
          const x0 = Math.min(...xs);
          const y0 = Math.min(...ys);
          const x1 = Math.max(...xs);
          const y1 = Math.max(...ys);
          addRect({ x0, y0, x1, y1 });
          i = consumedEnd; // skip consumed
        }
      }

      // Build blurred layer
      const temp = document.createElement("canvas");
      temp.width = w;
      temp.height = h;
      const tctx = temp.getContext("2d");
      if (!tctx) throw new Error("Canvas context error");
      tctx.filter = "blur(16px)";
      tctx.drawImage(canvas, 0, 0);

      rects.forEach((r) => {
        ctx.drawImage(temp, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      });

      setBlurredCount(rects.length);
      toast.success(`Anonymized ${rects.length} region${rects.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to anonymize image");
    } finally {
      setProcessing(false);
      setProgress(100);
    }
  }, []);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "anonymized.png";
    a.click();
  }, []);

  const hasResult = useMemo(() => blurredCount > 0, [blurredCount]);

  return (
    <main className="min-h-screen bg-background">
      <section className="bg-hero">
        <div className="container mx-auto py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Screenshot Anonymizer
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Detect and blur emails and phone numbers in images, privately in your browser.
            </p>
            <div className="flex flex-col items-center gap-4">
              <div className="flex w-full max-w-md items-center gap-2">
                <Input
                  id="file"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  aria-label="Choose an image file"
                />
                <Button onClick={anonymize} disabled={!imageURL || processing} className="shrink-0">
                  <ScanText className="mr-2 h-4 w-4" />
                  {processing ? `Analyzing ${progress}%` : "Anonymize"}
                </Button>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={download} disabled={!hasResult} className="shrink-0">
                  <Download className="mr-2 h-4 w-4" /> Save PNG
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-8">
            <article className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium mb-3">Original</h2>
              {imageURL ? (
                <img
                  ref={imgRef}
                  src={imageURL}
                  alt="Original uploaded screenshot"
                  loading="lazy"
                  className="mx-auto max-h-[60vh] w-auto"
                  onLoad={() => {
                    // Reset canvas when a new image loads
                    const c = canvasRef.current;
                    if (c) {
                      const ctx = c.getContext("2d");
                      if (ctx) ctx.clearRect(0, 0, c.width, c.height);
                    }
                  }}
                />
              ) : (
                <div className="text-muted-foreground text-sm">Choose an image to begin.</div>
              )}
            </article>

            <article className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium mb-3">Anonymized</h2>
              <canvas ref={canvasRef} className="mx-auto max-h-[60vh] w-auto" aria-label="Anonymized result canvas" />
              <p className="mt-3 text-sm text-muted-foreground">
                {processing
                  ? `Processing... ${progress}%`
                  : hasResult
                  ? `Blurred ${blurredCount} sensitive region${blurredCount === 1 ? "" : "s"}.`
                  : "No result yet. Click Anonymize to process."}
              </p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Index;
