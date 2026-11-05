// Syntax trees are derived from document text. An inactive pane can release
// them without replacing the editor state that owns selections, folds and undo.
export function configureEditorGrammar(view, compartment, active, load) {
  let alive = true;
  if (!active) view.dispatch({ effects: compartment.reconfigure([]) });
  else Promise.resolve().then(() => alive ? load() : null).then((grammar) => {
    if (alive) view.dispatch({ effects: compartment.reconfigure(grammar || []) });
  }).catch(() => {});
  return () => { alive = false; };
}
