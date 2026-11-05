"""Inspect only diagnostic snapshots from native-markdown-stream.cjs fixtures."""
import collections
import json
import sys

heap = json.load(open(sys.argv[1], encoding="utf-8"))
meta = heap["snapshot"]["meta"]
nodes, edges, strings = heap["nodes"], heap["edges"], heap["strings"]
nf = {key: index for index, key in enumerate(meta["node_fields"])}
ef = {key: index for index, key in enumerate(meta["edge_fields"])}
ns, es = len(nf), len(ef)
nt, et = meta["node_types"][nf["type"]], meta["edge_types"][ef["type"]]
incoming = collections.defaultdict(list)
offset = 0
for source in range(0, len(nodes), ns):
    for _ in range(nodes[source + nf["edge_count"]]):
        kind = et[edges[offset + ef["type"]]]
        key, target = edges[offset + ef["name_or_index"]], edges[offset + ef["to_node"]]
        if kind != "weak":
            incoming[target].append((source, kind, str(key) if kind in ("element", "hidden") else strings[key]))
        offset += es


def node_name(index):
    kind = nt[nodes[index + nf["type"]]]
    name = strings[nodes[index + nf["name"]]][:64]
    return f'{kind}:{name}#{nodes[index + nf["id"]]}'


# V8 truncates long snapshot names to 1,024 characters in this runtime. Count
# the actual node self_size rather than treating the truncated name as content.
replies = [index for index in range(0, len(nodes), ns)
           if nt[nodes[index + nf["type"]]] == "string"
           and strings[nodes[index + nf["name"]]].startswith("Paragraph 0: steady plain text ")
           and nodes[index + nf["self_size"]] > 2000]
replies.sort(key=lambda index: nodes[index + nf["self_size"]])
summary = {"matchingBackingStrings": len(replies),
           "selfBytes": sum(nodes[index + nf["self_size"]] for index in replies),
           "selfSizeRange": [nodes[index + nf["self_size"]] for index in (replies[:1] + replies[-1:])],
           "scope": "Strong retainer graph and self sizes for the synthetic paragraph fixture only; not a whole-heap retained-size calculation."}
print(json.dumps(summary, indent=2))
if replies:
    target = replies[len(replies) // 2]
    queue, seen, previous = collections.deque([target]), {target}, {}
    root = None
    while queue:
        at = queue.popleft()
        if at == 0 or (nt[nodes[at + nf["type"]]] == "synthetic"
                       and strings[nodes[at + nf["name"]]] in ("(Global handles)", "(Stack roots)", "(GC roots)")):
            root = at
            break
        for source, kind, key in incoming[at]:
            if source not in seen:
                seen.add(source)
                previous[source] = (at, kind, key)
                queue.append(source)
    if root is not None:
        print("ONE STRONG PATH TO", node_name(target))
        at = root
        while at != target:
            next_node, kind, key = previous[at]
            print(f"  {node_name(at)} --{kind}:{key}--> {node_name(next_node)}")
            at = next_node
