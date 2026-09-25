# SPOOL Design Studio update

The existing single-file website now includes a Design Studio at `index.html#studio`.

## Added
- Home / Design Studio navigation and a responsive garment selection page.
- Tee, hoodie, sweatshirt and sweatpants entry points into the existing editor.
- Editable lettering with Bold, Collegiate and Mono styles, ink color, wordmark, badge and box-label layouts.
- Transparent PNG graphic export, 2400 pixels wide (no embedded 300 dpi metadata).
- Text metadata saved with existing browser-local designs; undo uses the existing history.
- An accessible on-page design-name dialog in place of the native browser prompt.

No new libraries, build process or API credentials are required. Existing supplier/product options are prototype configurations, not confirmed inventory.

## Verified
JavaScript syntax; navigation; tee creation; starter graphic insertion; lettering/layout editing; default 8-inch front width in existing editor calibration; garment mockup; tech-pack artwork rendering; local save and restoration after refresh; restored lettering metadata; mobile Studio page at 390px without horizontal overflow; no console errors in the tested flow.

The embedded preview did not expose a completed download event. Test the Download graphic control and browser Print / Save as PDF in Chrome or Safari before publishing. The pre-existing sleeve-pattern-slv.png asset is missing in the supplied project; sleeve previews need that asset restored. Existing geometry and factory measurements should be checked against supplier specifications.

## Still to connect
AI graphics generation, genuine accounts/cloud storage, sample/contact/design-request delivery and supplier quoting. Current requests in the original prototype do not reach SPOOL. This update does not deploy or change spoolnyc.com.

## Publish
Back up the current GitHub Pages files. Replace index.html with this version, keep the existing assets folder and CNAME, then publish through the existing repository. Open /#studio to reach the new Studio.
