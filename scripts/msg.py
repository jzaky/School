#!/usr/bin/env python3
"""Merge bilingual message keys into messages/en.json and messages/ar.json.
Input JSON (file arg or stdin): {"namespace": {"key": ["English", "Arabic"], "nested": {"k": ["en","ar"]}}}"""
import json, sys

def split(tree):
    en, ar = {}, {}
    for k, v in tree.items():
        if isinstance(v, list):
            en[k], ar[k] = v[0], v[1]
        else:
            en[k], ar[k] = split(v)
    return en, ar

def merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict):
            dst.setdefault(k, {})
            merge(dst[k], v)
        else:
            dst[k] = v

data = json.load(open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin)
en_new, ar_new = split(data)
for path, new in (("messages/en.json", en_new), ("messages/ar.json", ar_new)):
    cur = json.load(open(path))
    merge(cur, new)
    json.dump(cur, open(path, "w"), ensure_ascii=False, indent=2)
    open(path, "a").write("\n")
print("merged", sum(1 for _ in json.dumps(data)) and len(data), "namespaces")
