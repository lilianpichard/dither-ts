import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { FormatOptions, FormatPicker, default as ExportPanel } from "./ExportPanel";
import { MESSAGES, type Locale } from "../i18n/messages";
import type { ExportFormat } from "./formats";

function render(node: React.ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <IntlProvider locale={locale} defaultLocale="en" messages={MESSAGES[locale]}>
      {node}
    </IntlProvider>,
  );
}

const NOOP = () => {};

const OPTIONS = {
  cell: 8,
  charset: " .:-=+*#%@",
  invert: false,
  black: false,
  onCell: NOOP,
  onCharset: NOOP,
  onInvert: NOOP,
  onBlack: NOOP,
};

function options(format: ExportFormat): string {
  return render(<FormatOptions format={format} {...OPTIONS} />);
}

describe("FormatOptions", () => {
  it("draws only the options the format has, so nothing is tuned for nothing", () => {
    // A png has no cell and no charset, so offering them invited editing an
    // output that could not respond.
    const png = options("png");
    expect(png).not.toContain('id="charset"');
    expect(png).not.toContain('id="invert"');
    expect(png).not.toContain('id="black-vector"');
  });

  it("draws the three text options for the text writer", () => {
    const txt = options("txt");
    expect(txt).toContain('id="charset"');
    expect(txt).toContain('id="invert"');
    // The cell is a slider, and its label carries the value rather than leaving
    // a placeholder behind.
    expect(txt).toContain("Cell 8");
    expect(txt).not.toContain("{value}");
  });

  it("draws the one vector option for the vector writer", () => {
    const svg = options("svg");
    expect(svg).toContain('id="black-vector"');
    expect(svg).not.toContain('id="charset"');
  });

  it("always says what the format does, which is the only line a png gets", () => {
    expect(options("png")).toContain("Lossless, keeps transparency");
    expect(options("jpg")).toContain("Compressed, white background");
    expect(options("svg")).toContain("Vector rectangles");
    expect(options("txt")).toContain("Plain text");
  });

  it("reads the same in French", () => {
    expect(render(<FormatOptions format="txt" {...OPTIONS} />, "fr")).toContain(
      "Jeu de caractères",
    );
    expect(render(<FormatOptions format="svg" {...OPTIONS} />, "fr")).toContain("Vecteur noir");
  });

  it("leaves no placeholder unfilled in either language", () => {
    // A missing value is silent: the formatter keeps the braces and the user
    // reads a template. This is the panel where an omitted value has to be
    // caught, because the catalogue cannot see the call site.
    for (const locale of ["en", "fr"] as const) {
      for (const format of ["png", "jpg", "svg", "txt"] as const) {
        const markup = render(<FormatOptions format={format} {...OPTIONS} />, locale);
        expect(markup, `${locale}/${format}`).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
  });
});

describe("ExportPanel", () => {
  it("shows nothing but the empty state when there is nothing to export", () => {
    // The panel used to draw the whole picker behind the empty state, and the two
    // overflowed into each other. One panel, one state: with nothing to write
    // there is nothing to pick a format for either.
    const markup = render(<ExportPanel />);
    expect(markup).toContain("Nothing to export");
    expect(markup).not.toContain('role="radiogroup"');
    expect(markup).not.toContain('data-slot="card"');
    expect(markup).not.toContain('data-slot="scroll-area"');
  });

  it("still announces the same state to a screen reader", () => {
    // The empty state is visible, so the live region has to stay in the tree
    // for the state that is not.
    const markup = render(<ExportPanel />);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="status"');
  });

  it("has no placeholder left unfilled in either language", () => {
    for (const locale of ["en", "fr"] as const) {
      expect(render(<ExportPanel />, locale)).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});

describe("FormatPicker", () => {
  it("offers the four writers as one group, not four loose buttons", () => {
    // A group is what lets one be the live one; four buttons read as four
    // actions, which is what this panel used to be.
    const markup = render(<FormatPicker format="png" onFormat={() => {}} />);
    const group = markup.slice(markup.indexOf('role="radiogroup"'));
    expect(group.slice(0, group.indexOf(">") + 1)).toContain('aria-label="Formats"');
    for (const label of ["PNG", "JPG", "SVG", "TXT"]) {
      expect(group).toContain(`>${label}</button>`);
    }
  });

  it("starts on png, so the first export is the lossless one", () => {
    const markup = render(<FormatPicker format="png" onFormat={() => {}} />);
    const [first] = markup.split("</button>");
    expect(first).toContain('data-state="on"');
    expect(first.endsWith(">PNG")).toBe(true);
  });

  it("makes each format a pointer target with a visible hover and selected state", () => {
    const markup = render(<FormatPicker format="svg" onFormat={() => {}} />);
    expect(markup).toContain("cursor-pointer");
    expect(markup).toContain("hover:bg-accent");
    expect(markup).toContain("data-[state=on]:bg-primary");
    expect(markup).toContain("data-[state=on]:text-primary-foreground");
  });

  it("marks the format it is given, so a move is visible", () => {
    const markup = render(<FormatPicker format="svg" onFormat={() => {}} />);
    const [first] = markup.split("</button>");
    expect(first).toContain('data-state="off"');
    expect(markup).toContain('data-state="on"');
    // The one that is on is the third, which is where svg sits.
    expect(markup.indexOf(">SVG</button>")).toBeGreaterThan(0);
  });

  it("reads the same in French", () => {
    const markup = render(<FormatPicker format="png" onFormat={() => {}} />, "fr");
    expect(markup).toContain(">PNG</button>");
    expect(markup).toContain('aria-label="Formats"');
  });
});
