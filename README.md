# Invigilation Duty Finder - Complete v29

Version 30 keeps all Version 28 logic and replaces the DIU campus image background with a video background.

Upload all files from this package directly to the GitHub repository root.

## Required background video

Upload your background video to the repository root with this exact filename:

```text
diu.mp4
```

The site uses this file as a muted, autoplaying, looping background video on every page. If a visitor enables reduced-motion settings, the video is hidden and a soft gradient fallback is shown.

## Pages included

- `index.html` - faculty duty roster search by name or initial
- `guidelines.html` - examination guidelines and dynamic slot schedule from `duty-roster.pdf`
- `committee.html` - exam committee contact directory with committee member images
- `attendance.html` - attendance sheet generator for selected exam date and slot

## Required PDF filenames

```text
duty-roster.pdf
faculty-list.pdf
exam-committee.pdf
```

Seat-plan PDF filename examples:

```text
27A_Seat Plan.pdf
27B_Seat Plan.pdf
27C_Seat Plan.pdf
```

## Committee photos

Upload committee member images using the faculty initial as the filename, for example:

```text
MHS.jpg
AAK.png
MJZ.jpeg
```

The site tries root-level images and common folders such as `images/`, `img/`, `photos/`, `committee-photos/`, and `assets/images/`. It supports `jpg`, `jpeg`, `png`, `gif`, `webp`, `jfif`, and `gpeg`, including uppercase/lowercase variants.

## Attendance generator

The attendance page:

- reads the roster PDF and faculty list PDF;
- loads the seat-plan PDF for the selected date and slot;
- counts students per room;
- applies the invigilator requirement rule:
  - `<= 30`: 1 invigilator
  - `<= 55`: 2 invigilators
  - `<= 75`: 3 invigilators
  - `> 75`: 4 invigilators
- tries not to assign contractual, part-time, or other-department faculty alone;
- keeps Room `204` reserve logic from Version 26;
- allows manual editing before download;
- downloads attendance sheets as PDF and DOCX.

## GitHub Pages setup

```text
Settings > Pages
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

After replacing files, wait for GitHub Pages to finish deployment, then hard refresh with `Ctrl + Shift + R`.

## Version

Integrated package version: 29.

## Version 30 background behavior

Upload `diu.mp4` to the repository root for the moving video background. The package also includes `diu-campus.jpg`.

On the Duty Roster page, when an individual faculty roster is opened, the video automatically pauses and the page shows `diu-campus.jpg` behind the roster cards. When the roster result is cleared or hidden, the video background resumes.


Version 33 note: Fixed first-day Slot A detection for the Final Examination Summer 2026 roster. The code now derives the start of duty columns from the roster header, so 19-Aug Slot A entries are detected correctly.
