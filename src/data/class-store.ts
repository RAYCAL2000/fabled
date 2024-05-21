import type { Writable }           from 'svelte/store';
import { get, writable }           from 'svelte/store';
import FabledFolder                from '$api/fabled-folder';
import { active, rename }          from './store';
import { sort }                    from '$api/api';
import { parseYaml }               from '$api/yaml';
import { browser }                 from '$app/environment';
import FabledClass                 from '$api/fabled-class';
import FabledSkill                 from '$api/fabled-skill';
import { goto }                    from '$app/navigation';
import { base }                    from '$app/paths';
import type { MultiClassYamlData } from '$api/types';
import YAML                        from 'yaml';
import { socketService }           from '$api/socket/socket-connector';
import { notify }                  from '$api/notification-service';

const loadClassesFromServer = async () => {
	let serverClasses: string[];
	try {
		serverClasses = await socketService.getClasses();
	} catch (_) {
		return;
	}

	const tempFolders = get(classFolders);
	const tempClasses = get(classes);
	serverClasses.forEach(c => {
		const parts = c.split('/');
		const name  = parts.pop();
		if (!name) return;

		let previous: FabledFolder | undefined;
		let folder: FabledFolder | undefined;
		parts.forEach(part => {
			folder = previous ? previous.getSubfolder(part) : tempFolders.find(f => f.name === part);
			if (!folder) {
				folder          = new FabledFolder();
				folder.name     = part;
				folder.location = 'server';
				if (previous) {
					previous.add(folder);
					folder.updateParent(previous);
				}
			}
			if (!previous && !tempFolders.includes(folder)) tempFolders.push(folder);
			previous = folder;
		});

		// If we already have this class, don't add it
		if (tempClasses.find(cl => cl.name === c)) return;

		const clazz = new FabledClass({ name: c, location: 'server' });
		if (folder) folder.add(clazz);
		tempClasses.push(clazz);
	});
	classes.set(tempClasses);
};

const removeServerClasses = () => {
	const tempClasses = get(classes);
	classes.set(tempClasses.filter(c => c.location !== 'server'));

	const tempFolders = get(classFolders);
	tempFolders.filter(f => f.location === 'server').forEach(f => deleteClassFolder(f, (sb) => sb.location === 'server'));
};

socketService.onConnect(loadClassesFromServer);
socketService.onDisconnect(removeServerClasses);

let isLegacy = false;

const loadClassTextToArray = (text: string): FabledClass[] => {
	const list: FabledClass[] = [];
	// Load classes
	const data                = <MultiClassYamlData>parseYaml(text);
	const keys                = Object.keys(data);

	let clazz: FabledClass;
	// If we only have one class, and it is the current YAML,
	// the structure is a bit different
	if (keys.length == 1) {
		const key = keys[0];
		if (key === 'loaded') return list;
		clazz = new FabledClass({ name: key });
		clazz.load(data[key]);
		list.push(clazz);
		return list;
	}

	for (const key of Object.keys(data)) {
		if (key != 'loaded') {
			clazz = new FabledClass({ name: key });
			clazz.load(data[key]);
			list.push(clazz);
		}
	}
	return list;
};

const setupClassStore = <T>(key: string,
														def: T,
														mapper: (data: string) => T,
														setAction: (data: T) => T,
														postLoad?: (saved: T) => void): Writable<T> => {
	let saved: T = def;
	if (browser) {
		const stored = localStorage.getItem(key);
		if (stored) {
			saved = mapper(stored);
			if (postLoad) postLoad(saved);
		}
	}

	const {
					subscribe,
					set,
					update
				} = writable<T>(saved);
	return {
		subscribe,
		set: (value: T) => {
			if (setAction) value = setAction(value);
			return set(value);
		},
		update
	};
};

export const classes: Writable<FabledClass[]> = setupClassStore<FabledClass[]>(
	browser && localStorage.getItem('classNames') ? 'classNames' : 'classData', [],
	(data: string) => {
		if (localStorage.getItem('classNames')) {
			return data.split(', ').map(name => new FabledClass({
				name,
				location: 'local'
			})).filter(cl => localStorage.getItem('sapi.class.' + cl.name));
		} else {
			localStorage.removeItem('classData');
			isLegacy = true;
			return sort<FabledClass>(loadClassTextToArray(data));
		}
	},
	(value: FabledClass[]) => {
		persistClasses(value);
		value.forEach(c => c.updateParent(value));
		return sort<FabledClass>(value);
	},
	(saved: FabledClass[]) => saved.forEach(c => c.updateParent(saved))); // This will be the gotcha here

export const getClass = (name: string): FabledClass | undefined => {
	for (const c of get(classes)) {
		if (c.name == name) return c;
	}

	return undefined;
};

export const classFolders: Writable<FabledFolder[]> = setupClassStore<FabledFolder[]>('classFolders', [],
	(data: string) => {
		if (!data || data === 'null') return [];

		try {
			return JSON.parse(data, (key: string, value) => {
				if (!value) return;
				if (/\d+/.test(key)) {
					if (typeof (value) === 'string') {
						return getClass(value);
					}

					const folder = new FabledFolder(value.data);
					folder.name  = value.name;
					return folder;
				}
				return value;
			});
		} catch (e) {
			console.error('Error loading class folders. Folder data: ' + data, e);
			notify('Error loading class folders. ' + JSON.stringify(e) + '\nFolder data: ' + data);
			return [];
		}
	},
	(value: FabledFolder[]) => {
		const data = JSON.stringify(value, (key, value: FabledFolder | FabledClass | FabledSkill) => {
			if (value instanceof FabledClass || value instanceof FabledSkill) return value.name;
			else if (key === 'parent') return undefined;
			return value;
		});
		localStorage.setItem('classFolders', data);
		return sort<FabledFolder>(value);
	});

export const updateAllAttributes = (attributes: string[]) =>
	get(classes).forEach(c => c.updateAttributes(attributes));

export const isClassNameTaken = (name: string): boolean => !!getClass(name);

export const addClass = (name?: string): FabledClass => {
	const cl  = get(classes);
	let index = cl.length + 1;
	while (!name && isClassNameTaken(name || 'Class ' + index)) {
		index++;
	}
	const clazz = new FabledClass({ name: (name || 'Class ' + index) });
	cl.push(clazz);

	classes.set(cl);
	clazz.save();
	return clazz;
};

export const loadClass = async (data: FabledClass) => {
	if (data.loaded) return;
	let yamlData: MultiClassYamlData;

	if (data.location === 'local') {
		yamlData = <MultiClassYamlData>parseYaml(localStorage.getItem(`sapi.class.${data.name}`) || '');
	} else {
		const yaml = await socketService.getClassYaml(data.name);
		if (!yaml) return;
		yamlData = <MultiClassYamlData>YAML.parse(yaml);
	}

	const clazz = Object.values(yamlData)[0];
	data.load(clazz);

	data.updateParent(get(classes));
	data.loaded = true;
};

export const cloneClass = async (data: FabledClass): Promise<FabledClass> => {
	if (!data.loaded) await loadClass(data);

	const cl: FabledClass[] = get(classes);
	let name                = data.name + ' (Copy)';
	let i                   = 1;
	while (isClassNameTaken(name)) {
		name = data.name + ' (Copy ' + i + ')';
		i++;
	}
	const clazz    = new FabledClass();
	const yamlData = data.serializeYaml();
	clazz.load(yamlData);
	clazz.name = name;
	cl.push(clazz);

	classes.set(cl);
	clazz.save();
	return clazz;
};

export const addClassFolder = (folder: FabledFolder) => {
	const folders = get(classFolders);
	if (folders.includes(folder)) return;

	rename(folder, folders);

	folders.push(folder);
	folders.sort((a, b) => a.name.localeCompare(b.name));
	classFolders.set(folders);
};

export const deleteClassFolder = (folder: FabledFolder, deleteCheck?: (subfolder: FabledFolder) => boolean) => {
	const folders = get(classFolders).filter(f => f != folder);

	folder.data.forEach(d => {
		if (d instanceof FabledFolder) {
			if (deleteCheck && deleteCheck(d)) {
				deleteClassFolder(d, deleteCheck);
				return;
			}
			if (folder.parent) folder.parent.add(d);
			else {
				d.updateParent();
				folders.push(d);
			}
		} else if (folder.parent)
			folder.parent.add(d); // Add the class to the parent folder
	});

	classFolders.set(folders);
};

export const deleteClass = (data: FabledClass) => {
	const filtered = get(classes).filter(c => c != data);
	const act      = get(active);
	classes.set(filtered);
	localStorage.removeItem('sapi.class.' + data.name);

	if (!(act instanceof FabledClass)) return;

	if (filtered.length === 0) goto(`${base}/`);
	else if (!filtered.find(cl => cl === get(active))) goto(`${base}/class/${filtered[0].name}/edit`);
};

export const refreshClasses      = () => classes.set(sort<FabledClass>(get(classes)));
export const refreshClassFolders = () => {
	classFolders.set(sort<FabledFolder>(get(classFolders)));
	refreshClasses();
};


/**
 *  Loads class data from a string
 */
export const loadClassText = (text: string, fromServer: boolean = false) => {
	// Load new classes
	const data = <MultiClassYamlData>parseYaml(text);

	if (!data || Object.keys(data).length === 0) {
		// If there is no data or the object is empty... return
		return;
	}

	const keys = Object.keys(data);

	let clazz: FabledClass;
	// If we only have one class, and it is the current YAML,
	// the structure is a bit different
	if (keys.length == 1) {
		const key: string = keys[0];
		clazz             = (<FabledClass>(isClassNameTaken(key)
			? getClass(key)
			: addClass(key)));
		if (fromServer) clazz.location = 'server';
		clazz.load(data[key]);
		refreshClasses();
		return;
	}

	for (const key of Object.keys(data)) {
		if (key != 'loaded' && !isClassNameTaken(key)) {
			clazz = (<FabledClass>(isClassNameTaken(key)
				? getClass(key)
				: addClass(key)));
			clazz.load(data[key]);
		}
	}
	refreshClasses();
};

export const loadClasses = (e: ProgressEvent<FileReader>) => {
	const text: string = <string>e.target?.result;
	if (!text) return;

	loadClassText(text);
};

export const persistClasses = (list?: FabledClass[]) => {
	const classList = (list || get(classes)).filter(c => c.location === 'local');
	localStorage.setItem('classNames', classList.map(c => c.name).join(', '));
};

if (isLegacy) {
	get(classes).forEach(clazz => {
		if (clazz.location === 'local') clazz.save();
	});
	persistClasses();
}