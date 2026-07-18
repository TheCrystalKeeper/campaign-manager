import { Fragment, type ReactNode } from "react";

/// <summary>
/// Shared building blocks for compendium picker preview panes. `PreviewLine` is a
/// bold-labelled "Armor: Light armor" row; `CompendiumDescription` renders free-text
/// entry descriptions, bolding leading "Label:" prefixes on each line and preserving
/// paragraph breaks.
/// </summary>

/** A "**Label:** value" line, e.g. <PreviewLine label="Armor">Light armor</PreviewLine>. */
export function PreviewLine({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={className}>
      <strong>{label}:</strong> {children}
    </p>
  );
}

// A short, label-like prefix at the start of a line: TitleCase-ish, no sentence
// punctuation, ending in a colon (e.g. "Ability Scores:", "Prerequisite:", "Material:").
const LEADING_LABEL = /^([A-Z][^:.!?\n]{0,40}):\s+([\s\S]*)$/;

/** Render an entry description: paragraphs split on blank lines, `Label:` prefixes bolded. */
export function CompendiumDescription({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n");
        return (
          <p key={pi}>
            {lines.map((line, li) => {
              const m = LEADING_LABEL.exec(line);
              return (
                <Fragment key={li}>
                  {li > 0 ? <br /> : null}
                  {m ? (
                    <>
                      <strong>{m[1]}:</strong> {m[2]}
                    </>
                  ) : (
                    line
                  )}
                </Fragment>
              );
            })}
          </p>
        );
      })}
    </>
  );
}
