import { useLayoutEffect, useRef, type ReactElement } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  Decoration,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
} from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { frontMatterEditing } from "../problem-export/front-matter-editor";

const externalValue = Annotation.define<boolean>();
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "#175cd3" },
  { tag: [tags.monospace, tags.processingInstruction], color: "#6941c6" },
  { tag: tags.quote, color: "#667085" },
  { tag: tags.meta, color: "#98a2b3" },
]);

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel = "题面 Markdown",
  lineKinds,
}: {
  value: string;
  onChange: (value: string, composing: boolean) => void;
  readOnly?: boolean;
  ariaLabel?: string;
  lineKinds?: readonly string[];
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const lineStyles = useRef(new Compartment());
  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let composing = false;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          lineStyles.current.of([]),
          // Extension order puts folding arrows to the right of line numbers.
          lineNumbers(),
          foldGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          frontMatterEditing,
          syntaxHighlighting(markdownStyle),
          keymap.of([
            ...foldKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            // Support the common Shift+Mod+Z redo binding on Windows too.
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          EditorState.phrases.of({
            "Fold line": "折叠内容",
            "Unfold line": "展开内容",
            unfold: "展开内容",
            "folded code": "已折叠的内容",
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(externalValue))
            )
              onChangeRef.current(update.state.doc.toString(), composing);
          }),
          EditorView.domEventObservers({
            compositionstart(_event, editor) {
              composing = true;
              // Cancel any pending preview before the first IME update.
              onChangeRef.current(editor.state.doc.toString(), true);
            },
            compositionend(_event, editor) {
              // Let CodeMirror process compositionend and the final input first.
              queueMicrotask(() => {
                if (viewRef.current !== editor) return;
                composing = false;
                onChangeRef.current(editor.state.doc.toString(), false);
              });
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalValue.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const marks = (lineKinds ?? []).flatMap((kind, index) =>
      kind !== "same" && index < view.state.doc.lines
        ? [
            Decoration.line({ class: `diff-line-${kind}` }).range(
              view.state.doc.line(index + 1).from,
            ),
          ]
        : [],
    );
    view.dispatch({
      effects: lineStyles.current.reconfigure(
        EditorView.decorations.of(Decoration.set(marks)),
      ),
    });
  }, [lineKinds, value]);

  return (
    <div className="markdown-editor">
      <div className="markdown-editor-view" ref={hostRef} />
    </div>
  );
}
