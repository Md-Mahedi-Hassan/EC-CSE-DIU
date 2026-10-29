# Invigilation Duty Finder — Version 39

GitHub Pages static site. Upload every file in this ZIP to the repository root; preserve your `diu.mp4` there if using a video background. There is no server.

## Attendance generator

On the **Attendance Sheet** page, select an exam date and slot. The program uses `duty-roster.pdf` and `faculty-list.pdf`, and reads a corresponding slot-specific seat-plan PDF if present (e.g. `28A_Seat Plan.pdf`). Otherwise it searches a combined day PDF (e.g. `Combine Seat Plan_28.pdf`) and reads **only pages explicitly labelled with the selected date and slot**. The two supplied example PDFs are included for testing.

**Annex duty rule**: A duty letter on a vivid green or strong red cell is an Annex duty for **that particular date and slot**. Only these faculty are eligible for rooms whose names start with `ANX1-`. Once Annex rooms are filled, remaining Annex-marked faculty are placed in `Reserve-Annex`. **Regular, unmarked faculty do not enter Annex rooms or Reserve-Annex.** Normal rooms and reserve Room 204 use the existing assignment priorities, including full-time lecturer preferences.

The on-screen assignments remain editable. PDFs and DOCX files contain distinct Annex and main-building sections, with an explicit page break before the main building. DOCX retains the real black Word header and gray repeating footer. All allocations are provisional until reviewed; a shortage or source-count discrepancy is surfaced as a warning, not concealed.

The room count rule remains 1 for <=30, 2 for <=55, 3 for <=75, 4 for >75. Both PDF and DOCX outputs support multi-page attendance tables.

Required source filenames: `duty-roster.pdf`, `faculty-list.pdf`, `exam-committee.pdf`. The included `diu-campus.jpg` is the fallback when `diu.mp4` is unavailable. The existing individual faculty roster search and its Annex highlights are preserved.

After GitHub deployment, hard-refresh with Ctrl+Shift+R. Do not upload the ZIP itself as a website file; extract it first.


## Version 40 changes

The PDF and DOCX attendance downloads omit the colored building-section captions under the page metadata. The main building uses **KT** in the upper-right, not `KT-204`; the Annex pages show **ANNEX**. Room 204 and Reserve-Annex still appear inside their respective tables, including when there are no eligible reserve invigilators (blank name/initial cells for manual completion).

The DOCX has separate Word sections for Annex and main buildings, with repeating black headers and a shared gray footer at the bottom of every page. It still starts the main building on a new page. The ordinary faculty roster, contact directory, committee page, and source parser behavior are unchanged.
