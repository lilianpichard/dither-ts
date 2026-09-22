import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_CHARSET, exportSVG, exportTXT } from "../../../src/index.js";
import { useApp } from "../store";
import { downloadText, downloadUrl } from "../lib/download";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

function rgbaToGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) | 0);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return out;
}

export default function ExportPanel() {
  const result = useApp((s) => s.result);
  const [cell, setCell] = useState(8);
  const [charset, setCharset] = useState(DEFAULT_CHARSET);
  const [invert, setInvert] = useState(false);
  const [black, setBlack] = useState(false);

  function current(): {
    data: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
  } | null {
    if (!result) return null;
    return {
      data: new Uint8ClampedArray(result.pixels.slice(0)),
      width: result.width,
      height: result.height,
    };
  }

  function raster(mime: string, ext: string, quality?: number) {
    const cur = current();
    if (!cur) return;
    const canvas = document.createElement("canvas");
    canvas.width = cur.width;
    canvas.height = cur.height;
    const ctx = canvas.getContext("2d")!;
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cur.width, cur.height);
    }
    ctx.putImageData(new ImageData(cur.data, cur.width, cur.height), 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          downloadUrl(URL.createObjectURL(blob), `dither.${ext}`);
          toast.success(`Exported dither.${ext}`);
        }
      },
      mime,
      quality,
    );
  }

  function svg() {
    const cur = current();
    if (!cur) return;
    downloadText(
      exportSVG(cur.data, cur.width, cur.height, { black }),
      "dither.svg",
      "image/svg+xml",
    );
    toast.success("Exported dither.svg");
  }

  function txt() {
    const cur = current();
    if (!cur) return;
    downloadText(
      exportTXT(rgbaToGray(cur.data), cur.width, cur.height, {
        cell,
        charset: charset || DEFAULT_CHARSET,
        invert,
      }),
      "dither.txt",
      "text/plain",
    );
    toast.success("Exported dither.txt");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!result} onClick={() => raster("image/png", "png")}>
            PNG
          </Button>
          <Button disabled={!result} onClick={() => raster("image/jpeg", "jpg", 0.92)}>
            JPG
          </Button>
          <Button disabled={!result} onClick={svg}>
            SVG
          </Button>
          <div className="flex items-center gap-2">
            <Switch id="black-vector" checked={black} onCheckedChange={setBlack} />
            <Label htmlFor="black-vector">Black vector</Label>
          </div>
          <Button disabled={!result} onClick={txt}>
            TXT
          </Button>
          <div className="flex items-center gap-2">
            <Label>Cell {cell}</Label>
            <Slider
              className="w-28"
              min={2}
              max={16}
              step={1}
              value={[cell]}
              onValueChange={([v]) => setCell(v)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="charset">Charset</Label>
            <Input
              id="charset"
              value={charset}
              className="w-32"
              onChange={(e) => setCharset(e.target.value)}
              placeholder={DEFAULT_CHARSET}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="invert" checked={invert} onCheckedChange={setInvert} />
            <Label htmlFor="invert">Invert</Label>
          </div>
        </div>
        {!result && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing to export</EmptyTitle>
              <EmptyDescription>Render an image first to enable export.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
