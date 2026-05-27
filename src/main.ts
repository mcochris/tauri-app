import { invoke } from "@tauri-apps/api/core";
import {
	PhysicalPosition,
	PhysicalSize,
	currentMonitor,
	getCurrentWindow,
} from "@tauri-apps/api/window";

// import Swal from 'sweetalert2';

const directoryDiv = document.getElementById("directoryFiles") as HTMLDivElement;
const currentPathDiv = document.getElementById("currentPath") as HTMLDivElement;
const musicFilesDiv = document.getElementById("musicFiles") as HTMLDivElement;

const backIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-left" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8"/></svg> ';
const homeIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-house" viewBox="0 0 16 16"><path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293zM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5z"/></svg> ';
const favoriteIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-heart" viewBox="0 0 16 16"><path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143q.09.083.176.171a3 3 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15"/></svg> ';

let homeDirectory = "";
let pathSeparator = "/";

let path = "";
// let currentPlayingPath: string | null = null;

function updateCurrentPathDisplay() {
	const favDir = localStorage.getItem("favoriteDirectory") || "";

	if (favDir && path === favDir) {
		currentPathDiv.innerHTML = `Current Path: ${path} ${favoriteIconSvg}`;
		return;
	}

	currentPathDiv.textContent = `Current Path: ${path}`;
}

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

directoryDiv.addEventListener("click", async (event) => {
	const target = (event.target as HTMLElement).closest("a[data-action]") as HTMLAnchorElement | null;

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

musicFilesDiv.addEventListener("click", async (event) => {
	const target = event.target as HTMLElement;
	const playButton = target.closest("button[data-action='play-toggle']") as HTMLButtonElement | null;

	if (playButton && musicFilesDiv.contains(playButton)) {
		const filePath = playButton.dataset.filePath;

		if (!filePath) {
			return;
		}

		if (playButton.textContent === "Play") {
			document.querySelectorAll(".play-button").forEach((button) => {
				(button as HTMLButtonElement).textContent = "Play";
			});

			await playMusic(filePath);
			playButton.textContent = "Stop";
		} else {
			await stopMusic();
			playButton.textContent = "Play";
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
		const targetWidth = Math.floor(workArea.size.width * 0.5);
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

	const dirs = await invoke("list_directories", { path }) as string[];
	const favDir = localStorage.getItem("favoriteDirectory") || "";
	const ul = document.createElement("ul") as HTMLUListElement;

	appendNavItem(
		ul,
		path !== pathSeparator,
		`${backIconSvg} Back`,
		"go-up",
	);

	appendNavItem(
		ul,
		path !== homeDirectory,
		`${homeIconSvg} Home`,
		"go-home",
	);

	appendNavItem(
		ul,
		Boolean(path !== favDir && path !== homeDirectory),
		`${favoriteIconSvg} Make fav dir`,
		"set-favorite",
	);

	appendNavItem(
		ul,
		Boolean(favDir && path !== favDir),
		`${favoriteIconSvg} Go to fav dir`,
		"go-favorite",
	);

	dirs.forEach((dir: string) => {
		const li = document.createElement("li") as HTMLLIElement;
		const link = createActionLink(dir, "open-directory", dir);

		// Display text
		li.appendChild(link);
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
	const musicFiles = await invoke("get_music_files", { "path": path }) as string[];

	musicFilesDiv.textContent = "";

	console.log("Music files in current directory:", musicFiles.length);

	if (musicFiles.length === 0) {
		musicFilesDiv.textContent = "No music files in this directory.";
		musicFilesDiv.style.fontStyle = "italic";
		return;
	}

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
	musicFilesDiv.appendChild(table);

	for (const filePath of musicFiles) {
		const fileName = filePath.split(pathSeparator).pop() || filePath;
		const rating = await invoke<number | false>("get_rating", { "pathname": filePath });

		const row = document.createElement("tr") as HTMLTableRowElement;
		const playCell = document.createElement("td") as HTMLTableCellElement;
		const ratingCell = document.createElement("td") as HTMLTableCellElement;

		playCell.textContent = fileName;
		playCell.className = "play-button";
		playCell.dataset.action = "play-toggle";
		playCell.dataset.filePath = filePath;
		ratingCell.className = "rating-cell";

		ratingCell.textContent = rating !== false ? `Rating: ${rating}` : "No rating";

		row.appendChild(playCell);
		row.appendChild(ratingCell);
		tbody.appendChild(row);
	}
}

//=============================================================================
// List music files in the current path
// This function is called after listing directories to show music files in the same path
//=============================================================================
// async function listMusicFiles() {
// 	const musicFiles = await invoke("get_music_files", { "path": path }) as string[];

// 	musicFilesDiv.textContent = "";

// 	if (musicFiles.length === 0) {
// 		musicFilesDiv.textContent = "No music files in this directory.";
// 		return;
// 	}

// 	const tableData: { id: number; filepath: string; rating: number | false }[] = [];

// 	for (const [index, filePath] of musicFiles.entries()) {
// 		tableData.push({
// 			id: index,
// 			filepath: filePath,
// 			rating: await invoke<number | false>("get_rating", { "pathname": filePath }),
// 		});
// 	}

// 	// new Tabulator("#musicfiles", {
// 	// 	data: tableData,
// 	// 	layout: "fitColumns",
// 	// 	columns: [
// 	// 		{ title: "ID", field: "id", visible: false },
// 	// 		{ title: "File (click to play/stop)", field: "filepath", formatter: pathNameFormatter },
// 	// 		{ title: "Rating", field: "rating", formatter: ratingFormatter, minWidth: 150 }
// 	// 	]
// 	// });

// 	// function pathNameFormatter(cell: Tabulator.CellComponent) {
// 	// 	const filePath = cell.getValue() as string;
// 	// 	const fileName = filePath.split(pathSeparator as string).pop() || filePath;
// 	// 	const link = document.createElement("a");

// 	// 	link.textContent = fileName;
// 	// 	link.href = "#";
// 	// 	link.addEventListener("click", async (event) => {
// 	// 		event.preventDefault();

// 	// 		if (currentPlayingPath === filePath) {
// 	// 			await stopMusic();
// 	// 			currentPlayingPath = null;
// 	// 			return;
// 	// 		}

// 	// 		await playMusic(filePath);
// 	// 		currentPlayingPath = filePath;
// 	// 	});

// 		// return link;
// 	}

// 	function ratingFormatter(cell: Tabulator.CellComponent) {
// 		const rowData = cell.getRow().getData() as { filepath: string; rating: number | false };
// 		const filePath = rowData.filepath;
// 		const wrapper = document.createElement("div");

// 		wrapper.className = "d-flex align-items-center gap-1";

// 		function renderRating(rating: number | false) {
// 			wrapper.replaceChildren();

// 			for (let starNumber = 1; starNumber <= 5; starNumber++) {
// 				const starButton = document.createElement("button");
// 				const starIcon = document.createElement("i");
// 				const isFilled = rating !== false && starNumber <= rating;

// 				starButton.type = "button";
// 				starButton.className = "btn btn-link p-0 border-0";
// 				starButton.style.color = "#d4af37";
// 				starButton.title = `Rate ${starNumber}`;
// 				starButton.setAttribute("aria-label", `Rate ${starNumber} star${starNumber === 1 ? "" : "s"}`);

// 				starIcon.className = `bi ${isFilled ? "bi-star-fill" : "bi-star"}`;
// 				starButton.appendChild(starIcon);

// 				starButton.addEventListener("click", async (event) => {
// 					event.preventDefault();
// 					event.stopPropagation();

// 					await rateMusic(filePath, starNumber);
// 					rowData.rating = starNumber;
// 					renderRating(starNumber);
// 				});

// 				wrapper.appendChild(starButton);
// 			}

// 			if (rating !== false) {
// 				const clearButton = document.createElement("button");
// 				const clearIcon = document.createElement("i");

// 				clearButton.type = "button";
// 				clearButton.className = "btn btn-link p-0 border-0 ms-2";
// 				clearButton.style.color = "currentColor";
// 				clearButton.dataset.action = "clear-rating";
// 				clearButton.dataset.filePath = filePath;
// 				clearButton.title = "Clear rating";
// 				clearButton.setAttribute("aria-label", "Clear rating");
// 				clearIcon.className = "bi bi-trash-fill";

// 				clearButton.appendChild(clearIcon);
// 				clearButton.addEventListener("click", async (event) => {
// 					event.preventDefault();
// 					event.stopPropagation();

// 					await clearRating(filePath);
// 					rowData.rating = false;
// 					renderRating(false);
// 				});

// 				wrapper.appendChild(clearButton);
// 			}
// 		}

// 		renderRating(cell.getValue() as number | false);

// 		return wrapper;
// 	}
// }

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
