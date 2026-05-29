import { invoke } from "@tauri-apps/api/core";
import {
	PhysicalPosition,
	PhysicalSize,
	currentMonitor,
	getCurrentWindow,
} from "@tauri-apps/api/window";

import Swal from 'sweetalert2';

const directoryDiv = document.getElementById("directoryFiles") as HTMLDivElement;
const currentPathDiv = document.getElementById("currentPath") as HTMLDivElement;
const musicFilesDiv = document.getElementById("musicFiles") as HTMLDivElement;
const headerAboutButton = document.getElementById("aboutButton") as HTMLButtonElement;
// const headerHelpButton = document.getElementById("helpButton") as HTMLButtonElement;

const backIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-left" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8"/></svg> ';
const homeIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-house" viewBox="0 0 16 16"><path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293zM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5z"/></svg> ';
const favoriteIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="red" class="bi bi-heart-fill" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314" /></svg>';
const starEmptyIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star" viewBox="0 0 16 16"><path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z" /></svg>'
const starFilledIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16"><path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z" /></svg>'
const trashCanIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" /><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" /></svg>';

let homeDirectory = "";
let pathSeparator = "/";

let path = "";
let currentPlayingPath: string | null = null;
let directoryToken = 0; // incremented on each navigation to cancel stale hash lookups

//=============================================================================
// Prevent header buttons from changing other link colors when clicked
//=============================================================================
headerAboutButton.addEventListener("click", async (event) => {
	event.preventDefault();
	Swal.fire({
		width: "40%",
		html: `<div class="title"><img src="/src-tauri/icons/64x64.png" alt="logo"><span class="title">Audiostar</span></div><p>Version 1.0.0</p><p>Database Path:<br><span class="dbLocation">${await invoke('get_database_path') as string}</span></p><p>GitHub Repository: <a href="https://github.com/mcochris/audiostar" target="_blank" rel="noopener">https://github.com/mcochris/audiostar</a></p>`,
		confirmButtonText: "OK",
		theme: "auto",
	});
});

//=============================================================================
// Updates the current path display. Shows the path text with a favorite
// icon if the current path matches the saved favorite directory. Also
// renders navigation buttons (Home, Set Favorite, Go to Favorite) based
// on the current path state.
//=============================================================================
function updateCurrentPathDisplay() {
	const favDir = localStorage.getItem("favoriteDirectory") || "";

	currentPathDiv.innerHTML = "";

	const pathText = document.createElement("span");

	if (favDir && path === favDir) {
		pathText.innerHTML = `Current Path: ${path}&nbsp;&nbsp;&nbsp;${favoriteIconSvg}`;
	} else {
		pathText.textContent = `Current Path: ${path}`;
	}

	currentPathDiv.appendChild(pathText);

	const buttonsDiv = document.createElement("div");

	buttonsDiv.id = "pathButtons";

	if (path !== homeDirectory) {
		buttonsDiv.appendChild(createActionLink(`${homeIconSvg} Home`, "go-home"));
	}

	if (path !== favDir && path !== homeDirectory) {
		buttonsDiv.appendChild(createActionLink(`${favoriteIconSvg} Make fav dir`, "set-favorite"));
	}

	if (favDir && path !== favDir) {
		buttonsDiv.appendChild(createActionLink(`${favoriteIconSvg} Go to fav dir`, "go-favorite"));
	}

	currentPathDiv.appendChild(buttonsDiv);
}

//=============================================================================
// Creates and returns an anchor element configured with an href of "#",
// an innerHTML label, and data-action / optional data-value dataset
// attributes for use with delegated click handlers.
//=============================================================================
function createActionLink(labelHtml: string, action: string, value?: string) {
	const link = document.createElement("a") as HTMLAnchorElement;

	link.innerHTML = labelHtml;
	link.href = "#";
	link.dataset.action = action;

	if (value) {
		link.dataset.value = value;
	}

	return link;
}

//=============================================================================
// Conditionally appends a list item containing an action link to the
// given UL element. Returns false without modifying the list when
// shouldRender is false; otherwise appends the item and returns true.
//=============================================================================
function appendNavItem(
	list: HTMLUListElement,
	shouldRender: boolean,
	labelHtml: string,
	action: string,
	value?: string,
) {
	if (!shouldRender) {
		return false;
	}

	const item = document.createElement("li") as HTMLLIElement;
	const link = createActionLink(labelHtml, action, value);

	item.appendChild(link);
	list.appendChild(item);

	return true;
}

//=============================================================================
// Handles delegated click events on the directory panel. Navigates into
// a sub-directory, up one level, to the home directory, or to the saved
// favorite directory. Also persists the current path as the favorite
// directory when the set-favorite action is triggered.
//=============================================================================
directoryDiv.addEventListener("click", async (event) => {
	const target = (event.target as HTMLElement).closest("[data-action]") as HTMLElement | null;

	if (!target || !directoryDiv.contains(target)) {
		return;
	}

	event.preventDefault();

	const action = target.dataset.action;
	const value = target.dataset.value;
	const favDir = localStorage.getItem("favoriteDirectory") || "";

	if (action === "set-favorite") {
		localStorage.setItem("favoriteDirectory", path);
		await listDirectories();
		return;
	}

	if (action === "open-directory" && value) {
		path = path === pathSeparator ? `${pathSeparator}${value}` : `${path}${pathSeparator}${value}`;
	} else if (action === "go-up") {
		path = path.split(pathSeparator).slice(0, -1).join(pathSeparator) || pathSeparator;
	} else if (action === "go-home") {
		path = homeDirectory;
	} else if (action === "go-favorite" && favDir) {
		path = favDir;
	} else {
		return;
	}

	await listDirectories();
});

//=============================================================================
// Handles delegated click events on the current path display bar.
// Responds to the set-favorite, go-home, and go-favorite actions to
// update the current path and refresh the directory listing.
//=============================================================================
currentPathDiv.addEventListener("click", async (event) => {
	const target = (event.target as HTMLElement).closest("[data-action]") as HTMLElement | null;

	if (!target || !currentPathDiv.contains(target)) {
		return;
	}

	event.preventDefault();

	const action = target.dataset.action;
	const favDir = localStorage.getItem("favoriteDirectory") || "";

	if (action === "set-favorite") {
		localStorage.setItem("favoriteDirectory", path);
	} else if (action === "go-home") {
		path = homeDirectory;
	} else if (action === "go-favorite" && favDir) {
		path = favDir;
	} else {
		return;
	}

	await listDirectories();
});

//=============================================================================
// Handles click events on the music file table. Toggles play/stop for a
// track when its play-toggle cell is clicked, and clears a track's star
// rating when the clear-rating button is clicked.
//=============================================================================
musicFilesDiv.addEventListener("click", async (event) => {
	const target = event.target as HTMLElement;
	const playCell = target.closest("[data-action='play-toggle']") as HTMLElement | null;

	if (playCell && musicFilesDiv.contains(playCell)) {
		const filePath = playCell.dataset.filePath;

		if (!filePath) {
			return;
		}

		if (currentPlayingPath === filePath) {
			await stopMusic();
			currentPlayingPath = null;
			document.querySelectorAll(".play-button.playing").forEach((el) => el.classList.remove("playing"));
		} else {
			document.querySelectorAll(".play-button.playing").forEach((el) => el.classList.remove("playing"));
			await playMusic(filePath);
			currentPlayingPath = filePath;
			playCell.classList.add("playing");
		}

		return;
	}

	const clearButton = target.closest("button[data-action='clear-rating']") as HTMLButtonElement | null;

	if (!clearButton || !musicFilesDiv.contains(clearButton)) {
		return;
	}

	const filePath = clearButton.dataset.filePath;
	const row = clearButton.closest("tr");

	if (!filePath || !row) {
		return;
	}

	row.querySelectorAll("input[type='radio']").forEach((radio) => {
		(radio as HTMLInputElement).checked = false;
	});

	await clearRating(filePath);
});

//=============================================================================
// Handles change events on the music file table. Reads the star rating
// from a radio input's dataset and invokes rateMusic to persist the new
// rating for the selected track.
//=============================================================================
musicFilesDiv.addEventListener("change", (event) => {
	const radio = (event.target as HTMLElement).closest("input[type='radio'][data-file-path]") as HTMLInputElement | null;

	if (!radio || !musicFilesDiv.contains(radio)) {
		return;
	}

	const filePath = radio.dataset.filePath;
	const rating = Number(radio.dataset.rating);

	if (!filePath || Number.isNaN(rating)) {
		return;
	}

	void rateMusic(filePath, rating);
});

//=============================================================================
// Resize and center the window to use most of the current monitor work area
//=============================================================================
async function resizeWindowToDisplay() {
	if (!("__TAURI_INTERNALS__" in window)) {
		return;
	}

	try {
		const monitor = await currentMonitor();

		if (!monitor) {
			return;
		}

		const workArea = monitor.workArea;
		const targetWidth = Math.floor(workArea.size.width * 0.75);
		const targetHeight = Math.floor(workArea.size.height * 0.75);

		const x = workArea.position.x + Math.floor((workArea.size.width - targetWidth) / 2);
		const y = workArea.position.y + Math.floor((workArea.size.height - targetHeight) / 2);

		const appWindow = getCurrentWindow();

		await appWindow.setSize(new PhysicalSize(targetWidth, targetHeight));
		await appWindow.setPosition(new PhysicalPosition(x, y));
	} catch (error) {
		console.warn("Unable to resize window on startup:", error);
	}
}

//=============================================================================
// List directories and music files in the current path
// This function is called on initial load and whenever the path changes
//=============================================================================
async function listDirectories() {
	// Clear previous directory list
	directoryDiv.innerHTML = "";
	updateCurrentPathDisplay();

	if (currentPlayingPath) {
		await stopMusic();
		currentPlayingPath = null;
	}

	const dirs = await invoke("list_directories", { path }) as string[];
	// const favDir = localStorage.getItem("favoriteDirectory") || "";
	const ul = document.createElement("ul") as HTMLUListElement;

	appendNavItem(
		ul,
		path !== pathSeparator,
		`${backIconSvg} Back`,
		"go-up",
	);

	dirs.forEach((dir: string) => {
		const li = document.createElement("li") as HTMLLIElement;
		const span = document.createElement("span") as HTMLSpanElement;

		span.textContent = dir;
		span.dataset.action = "open-directory";
		span.dataset.value = dir;
		span.className = "directory-name";

		li.appendChild(span);
		ul.appendChild(li);
	});

	directoryDiv.appendChild(ul);

	await listMusicFiles();
}

//=============================================================================
// Initial display
//=============================================================================
async function initializeApp() {
	await resizeWindowToDisplay();

	homeDirectory = await invoke("get_home_directory") as string;
	pathSeparator = await invoke("get_path_separator") as string;
	const favDir = localStorage.getItem("favoriteDirectory") || "";
	path = favDir ? favDir : homeDirectory;
	await listDirectories();
}

initializeApp();

//=============================================================================
// List music files in the current path
// This function is called after listing directories to show music files in the same path
//=============================================================================
async function listMusicFiles() {
	const token = ++directoryToken;
	const musicFiles = await invoke("get_music_files", { "path": path }) as string[];

	musicFilesDiv.textContent = "";

	if (musicFiles.length === 0) {
		musicFilesDiv.textContent = "No music files in this directory.";
		musicFilesDiv.style.fontStyle = "italic";
		return;
	}

	musicFilesDiv.style.fontStyle = "normal";
	const table = document.createElement("table") as HTMLTableElement;
	const thead = document.createElement("thead") as HTMLTableSectionElement;
	const headerRow = document.createElement("tr") as HTMLTableRowElement;
	const playHeader = document.createElement("th") as HTMLTableCellElement;
	const ratingHeader = document.createElement("th") as HTMLTableCellElement;

	playHeader.textContent = "File (click to play/stop)";
	ratingHeader.textContent = "Rating";
	headerRow.appendChild(playHeader);
	headerRow.appendChild(ratingHeader);
	thead.appendChild(headerRow);
	table.appendChild(thead);

	const tbody = document.createElement("tbody") as HTMLTableSectionElement;
	table.appendChild(tbody);

	// Build the table skeleton immediately — one row per file with no rating
	// displayed yet, so the user sees the full file list without any delay.
	const ratingCells = new Map<string, HTMLTableCellElement>();

	for (const filePath of musicFiles) {
		const fileName = (filePath.split(pathSeparator).pop() || filePath).replace(/\.[^.]+$/, "");

		const row = document.createElement("tr") as HTMLTableRowElement;
		const playCell = document.createElement("td") as HTMLTableCellElement;
		const ratingCell = document.createElement("td") as HTMLTableCellElement;

		playCell.textContent = fileName;
		playCell.className = "play-button";
		playCell.dataset.action = "play-toggle";
		playCell.dataset.filePath = filePath;
		ratingCell.className = "rating-cell";

		row.appendChild(playCell);
		row.appendChild(ratingCell);
		tbody.appendChild(row);
		ratingCells.set(filePath, ratingCell);
	}

	// Append the complete table in one DOM operation so the browser paints
	// all rows at once before any async work begins.
	musicFilesDiv.appendChild(table);

	// Fetch all pathname-based ratings in a single IPC call.
	if (directoryToken !== token) return;
	const ratingsMap = await invoke<Record<string, number | null>>("get_ratings_batch", { "pathnames": musicFiles });
	if (directoryToken !== token) return;

	// Files with no pathname match queued for background hash lookup
	const hashLookupQueue: Array<{ filePath: string; ratingCell: HTMLTableCellElement }> = [];

	for (const filePath of musicFiles) {
		const ratingCell = ratingCells.get(filePath)!;
		const rawRating = ratingsMap[filePath];
		const rating: number | false = typeof rawRating === "number" ? rawRating : false;

		await ratingFormatter(filePath, ratingCell, rating);

		if (rating === false) {
			hashLookupQueue.push({ filePath, ratingCell });
		}
	}

	// Background hash-based lookup for unrated files. Processed one at a time
	// so hash computation never saturates Tauri's thread pool. The token check
	// aborts the loop as soon as the user navigates to another directory.
	(async () => {
		for (const { filePath, ratingCell } of hashLookupQueue) {
			if (directoryToken !== token) break;
			try {
				const hashRating = await invoke<number | false>("get_rating_by_audio_hash", { "pathname": filePath });
				if (directoryToken !== token) break;
				if (hashRating !== false && document.contains(ratingCell)) {
					await ratingFormatter(filePath, ratingCell, hashRating);
				}
			} catch (e) {
				console.error(e);
			}
		}
	})();
}

//=============================================================================
// Rating formatter to display star icons based on the rating value
//=============================================================================
async function ratingFormatter(filePath: string, cell: HTMLTableCellElement, rating: number | false) {
	cell.textContent = "";

	const wrapper = document.createElement("div");
	wrapper.className = "rating-cell-wrapper";

	const starButtons: HTMLButtonElement[] = [];

	const updateStarIcons = (hoveredStar: number | null) => {
		starButtons.forEach((btn, index) => {
			const starNum = index + 1;
			const filled = hoveredStar !== null
				? starNum <= hoveredStar
				: rating !== false && starNum <= rating;
			btn.querySelector("i")!.innerHTML = filled ? starFilledIconSvg : starEmptyIconSvg;
		});
	};

	let docMoveHandler: ((e: MouseEvent) => void) | null = null;

	const stopTrackingLeave = () => {
		if (docMoveHandler) {
			document.removeEventListener("mousemove", docMoveHandler);
			docMoveHandler = null;
		}
	};

	const startTrackingLeave = () => {
		if (docMoveHandler) return;
		docMoveHandler = (e: MouseEvent) => {
			const rect = wrapper.getBoundingClientRect();
			if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
				updateStarIcons(null);
				stopTrackingLeave();
			}
		};
		document.addEventListener("mousemove", docMoveHandler);
	};

	for (let starNumber = 1; starNumber <= 5; starNumber++) {
		const starButton = document.createElement("button");
		const starIcon = document.createElement("i");
		const isFilled = rating !== false && starNumber <= rating;

		starButton.type = "button";
		starButton.className = "star-button";
		starButton.title = `Rate ${starNumber}`;
		starButton.setAttribute("aria-label", `Rate ${starNumber} star${starNumber === 1 ? "" : "s"}`);

		starIcon.innerHTML = isFilled ? starFilledIconSvg : starEmptyIconSvg;
		starButton.appendChild(starIcon);
		starButton.addEventListener("click", async () => {
			await rateMusic(filePath, starNumber);
			await ratingFormatter(filePath, cell, starNumber);
		});
		starButton.addEventListener("mouseenter", () => {
			updateStarIcons(starNumber);
			startTrackingLeave();
		});

		starButtons.push(starButton);
		wrapper.appendChild(starButton);
	}

	wrapper.addEventListener("mouseleave", () => {
		updateStarIcons(null);
		stopTrackingLeave();
	});

	if (rating !== false) {
		const clearButton = document.createElement("button");
		const clearIcon = document.createElement("i");

		clearButton.type = "button";
		clearButton.className = "clear-rating-button";
		clearButton.dataset.action = "clear-rating";
		clearButton.dataset.filePath = filePath;
		clearButton.title = "Clear rating";
		clearButton.setAttribute("aria-label", "Clear rating");
		clearIcon.innerHTML = trashCanIconSvg;
		clearButton.appendChild(clearIcon);
		clearButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();

			await clearRating(filePath);
			await ratingFormatter(filePath, cell, false);
		});

		wrapper.appendChild(clearButton);
	}

	cell.appendChild(wrapper);
}

//=============================================================================
// Play and stop music functions
//=============================================================================
async function playMusic(pathname: string) {
	await invoke("play_music_file", { "pathname": pathname });
}

async function stopMusic() {
	await invoke("stop_music_file");
}

//=============================================================================
// Rate music and clear rating functions
//=============================================================================
async function rateMusic(pathname: string, rating: number) {
	await invoke("rate_music_file", { "pathname": pathname, "rating": rating });
}

async function clearRating(pathname: string) {
	await invoke("clear_rating", { "pathname": pathname });
}
