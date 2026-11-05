// Syntax trees are derived from document text. An inactive pane can release
// them without replacing the editor state that owns selections, folds and undo.
export function configureEditorGrammar(view, compartment, active, load) {
  if (!active) {
    view.dispatch({ effects: compartment.reconfigure([]) });
    return () => {};
  }
  // An import cannot be aborted, but its cancelled UI owner can be released.
  // Do not capture the view parameter in a retained cleanup or promise callback.
  let owner = view;
  Promise.resolve().then(() => owner ? load() : null).then((grammar) => {
    if (owner) owner.dispatch({ effects: compartment.reconfigure(grammar || []) });
  }).catch(() => {});
  return () => { owner = null; };
}
