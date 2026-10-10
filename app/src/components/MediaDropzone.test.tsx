import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { MediaDropzone } from "./MediaDropzone";
import { MESSAGES } from "@/i18n/messages";

/**
 * No DOM is available to these tests, so what is checked here is what the
 * control advertises: one entry point, accepting both kinds. The routing itself
 * lives in mediaKindOf, which has its own suite.
 */
function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <IntlProvider locale="en" defaultLocale="en" messages={MESSAGES.en}>
      {node}
    </IntlProvider>,
  );
}

const en = (id: keyof typeof MESSAGES.en): string => MESSAGES.en[id];

describe("MediaDropzone", () => {
  it("offers both kinds in a single control", () => {
    const markup = render(<MediaDropzone onFile={() => {}} />);
    expect(markup).toContain('accept="image/*,video/*"');
    expect(markup).toContain(`aria-label="${en("rail.dropMedia")}"`);
    expect(markup).toContain(en("rail.clickOrDrop"));
  });

  it("shows the loaded file name once something is loaded", () => {
    const markup = render(<MediaDropzone onFile={() => {}} fileName="clip.mp4" />);
    expect(markup).toContain("clip.mp4");
    expect(markup).toContain(en("rail.replace"));
  });

  it("keeps a real button so it is reachable by keyboard", () => {
    const markup = render(<MediaDropzone onFile={() => {}} />);
    expect(markup).toContain("<button");
    expect(markup).not.toContain('tabindex="0"');
  });

  it("hides its input from assistive tech, since the button names the action", () => {
    const markup = render(<MediaDropzone onFile={() => {}} />);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("still reads the same in French", () => {
    // The provider is given the French catalogue, so the label comes from it:
    // proof the control is not hardcoding its own copy.
    const markup = renderToStaticMarkup(
      <IntlProvider locale="fr" defaultLocale="en" messages={MESSAGES.fr}>
        <MediaDropzone onFile={() => {}} />
      </IntlProvider>,
    );
    expect(markup).toContain(en("rail.dropMedia").length > 0 ? MESSAGES.fr["rail.dropMedia"] : "");
    expect(markup).not.toContain(MESSAGES.en["rail.dropMedia"]);
  });
});
