import { useState } from "react";
import { DEFAULT_CHARSET, exportSVG, exportTXT } from "../../../src/index.js";
import { useApp } from "../store";
import { downloadText, downloadUrl } from "../lib/download";

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
        if (blob) downloadUrl(URL.createObjectURL(blob), `dither.${ext}`);
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
  }

  return (
    <section>
      <h2>Export</h2>
      <div className="row">
        <button disabled={!result} onClick={() => raster("image/png", "png")}>
          PNG
        </button>
        <button disabled={!result} onClick={() => raster("image/jpeg", "jpg", 0.92)}>
          JPG
        </button>
        <button disabled={!result} onClick={svg}>
          SVG
        </button>
        <label>
          <input type="checkbox" checked={black} onChange={(e) => setBlack(e.target.checked)} />{" "}
          black vector
        </label>
        <button disabled={!result} onClick={txt}>
          TXT
        </button>
        <label>
          cell{" "}
          <input
            type="range"
            min={2}
            max={16}
            value={cell}
            onChange={(e) => setCell(Number(e.target.value))}
          />{" "}
          {cell}
        </label>
        <label>
          charset{" "}
          <input
            value={charset}
            size={12}
            onChange={(e) => setCharset(e.target.value)}
            placeholder={DEFAULT_CHARSET}
          />
        </label>
        <label>
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />{" "}
          invert
        </label>
      </div>
      {!result && <p id="status">Render an image first to enable export.</p>}
    </section>
  );
}
