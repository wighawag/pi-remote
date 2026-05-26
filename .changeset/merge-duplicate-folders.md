---
"pi-remote-server": patch
---

fix: show full folder path under folder name in session sidebar

When multiple directories share the same basename (e.g. `/home/user/wighawag`
and `/home/user/projects/wighawag`), they appeared as separate groups with the
same visible name, making them indistinguishable. Now the full resolved path is
shown in smaller gray text beneath the folder name for easy differentiation.
