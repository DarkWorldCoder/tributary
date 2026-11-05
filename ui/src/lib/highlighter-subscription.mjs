// A shared grammar import may finish after its component has unmounted. The
// subscriber is an explicit owner; a cancellation flag alone still roots its
// React dispatch/Fiber through the promise reaction.
export function subscribeHighlighter(load, receive) {
  let owner = receive;
  Promise.resolve().then(() => owner ? load() : undefined).then(value => {
    const deliver = owner; owner = null;
    deliver?.(value);
  }).catch(() => { owner = null; });
  return () => { owner = null; };
}
