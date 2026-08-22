# Frontend parity gaps vs. `prototype/`

Tracking list from comparing the new Flutter frontend against the prototype's
`public/main.js` + `input.js` + `tree.js`. Functional gaps first (things that
don't work yet), then polish (works, but rougher than the original). See
`CLAUDE.md` for the architecture these plug into.

## Functional

- [x] **Set/change a family's root ancestors from Settings.** Tapping a
      family card in Settings opens the shared person-picker (father, then
      mother) and calls `POST /roots/:familyId`. Verified end-to-end.
- [x] **Browse screen filters + depth-first sort.** Gender, alive/deceased,
      age-range, has-birthday, and "descendants of X" filters, plus
      `lib/browse/tree_order.dart` (ported `computeTreeOrder`) as the default
      sort. Verified: filters combine correctly, row count updates live.
- [x] **Relationship editing via person-picker, not free text.** `lib/widgets/person_picker.dart`
      is the shared live-search picker, used by Profile (father/mother/spouse/children),
      Settings (family roots), and Browse (descendants-of). Verified: add a
      spouse via search, save, persists, and view mode shows it as a
      clickable link.
- [x] **Search box on the Tree screen's person list.** Verified: typing
      filters the 324-person list live.

## Polish

- [x] Profile view: computed age display; clickable map/tel/mailto icons on
      address/phone/email (matches prototype's 📍/📞/✉️ links).
- [x] Settings: Owner/Editor/Viewer role badge shown per family.
- [x] Browse CSV export: drops `familyId`, includes the tree-order column,
      date-stamps the filename.
- [x] Search screen: empty search results show a "Create '<query>'" button
      pre-filled with the typed name, instead of a generic always-visible FAB.

## Infrastructure (not frontend — noted, not started)

- [ ] Postgres equivalent of `backup.sh` (dump → off-site upload).
- [ ] CI/CD deploy pipeline for the new stack (blocked on a hosting decision).
- [ ] Bootstrap story for the first local admin account (minor — CAS login
      changes this story vs. the prototype's `cli.js`).
