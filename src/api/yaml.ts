/*
 * This file was pulled from the original SkillAPI editor and updated to use TypeScript
 * and modern JavaScript as well as to add serialization
 */

import type ProComponent from "./components/procomponent";
import { v4 as uuid } from "uuid";
import { Conditions, Mechanics, Targets, Triggers } from "$api/components/components";
import type ProMechanic from "$api/components/mechanics";
import type ProTrigger from "$api/components/triggers";
import type ProTarget from "$api/components/targets";

/**
 * RegEx patterns used by the YAML parser
 */
const Regex = {
  INT: /^-?[0-9]+$/,
  FLOAT: /^-?[0-9]+\.[0-9]+$/,
  SPACE: /^( +)/
};

/**
 * Parses the YAML data string
 *
 * @param {string} text - the YAML data string
 *
 * @returns {YAMLObject} the parsed data
 */
export const parseYAML = (text: string): YAMLObject => {
  text = text.replace(/\r\n/g, "\n").replace(/\n *\n/g, "\n").replace(/ +\n/g, "\n");
  const data = new YAMLObject();
  const index = 0;
  const lines = text.split("\n");
  data.parse(lines, index, 0);
  return data;
};

/**
 * Counts the number of leading spaces in a string
 *
 * @param {string} string - the string to check
 *
 * @returns {Number} the number of leading spaces
 */
export const countSpaces = (string: string): number => {
  const m = string.match(Regex.SPACE);
  return !m ? 0 : m[1].length;
};

/**
 * Represents a collection of YAML data (ConfigurationSection in Bukkit)
 */
export class YAMLObject {
  public key?: string;
  public data: any = {};

  constructor(key?: string) {
    this.key = key;
  }

  public put = (key: string, value: any) => {
    this.data[key] = value;
  };

  /**
   * Checks whether the YAML data contains a value under the given key
   *
   * @param {string} key - key of the value to check for
   *
   * @returns {boolean} true if contains the value, false otherwise
   */
  public has = (key: string): boolean => {
    return this.data[key] !== undefined;
  };

  /**
   * Retrieves a value from the data
   *
   * @param {string} key   - key of the value to retrieve
   * @param {Object} value - default value to return if one isn't found
   *
   * @returns {string} the obtained value
   */
  public get = <T, V>(key: string, value?: V, mapping?: (str: T) => any): V => {
    if (this.data[key] == "[]" || this.data[key] == " []")
      this.data[key] = JSON.parse((<string>this.data[key]).trim());

    const val: V = this.has(key)
      ? (mapping ? <V>mapping(<T>this.data[key]) : <V>this.data[key])
      : <V>value;

    return <V>val;
  };

  public getKeys = (): string[] => {
      return Object.keys(this.data);
  };

  public remove = (key: string) => {
    delete this.data[key];
  };

  /**
   * Parses YAML data using the provided parameters
   *
   * @param {Array}  lines  - the lines of the YAML data
   * @param {Number} index  - the starting index of the data to parse
   * @param {Number} indent - the number of spaces preceeding the keys of the data
   *
   * @returns {Number} the ending index of the parsed data
   */
  public parse = (lines: any[], index: number, indent: number, exKey?: string): number => {
    if (exKey) this.key = exKey;
    while (index < lines.length && countSpaces(lines[index]) >= indent) {
      while (index < lines.length && (countSpaces(lines[index]) != indent || lines[index].replace(/ /g, "").charAt(0) == "#" || lines[index].indexOf(":") == -1)) index++;
      if (index == lines.length) return index;

      let key = lines[index].substring(indent, lines[index].indexOf(":"));
      if (key === "loaded") {
        index++;
        continue;
      }
      if (key.match(/^["'].*["']$/)) key = key.substring(1, key.length - 1);
      if (!this.key && !exKey) this.key = key;

      // New empty section
      if (lines[index].indexOf(": {}") == lines[index].length - 4 && lines[index].length >= 4) {
        this.data[key] = {};
      }

      // String list
      else if (index < lines.length - 1
        && lines[index + 1].charAt(indent) == "-"
        && lines[index + 1].charAt(indent + 1) == " "
        && countSpaces(lines[index + 1]) == indent) {
        const stringList = [];
        while (++index < lines.length && lines[index].charAt(indent) == "-") {
          let str = lines[index].substring(indent + 2);
          if (str.charAt(0) == "'" || str.charAt(0) == "\"")
            str = str.substring(1, str.length - 1).replace(/\\(['"])/, ($1: string) => $1.replace("\\", ""));
          stringList.push(str);
        }
        this.data[key] = stringList;
        index--;
      }

      // New section with content
      else if (index < lines.length - 1 && countSpaces(lines[index + 1]) > indent) {
        index++;
        const newIndent = countSpaces(lines[index]);
        const newData = new YAMLObject();
        index = newData.parse(lines, index, newIndent, key) - 1;
        this.data[key] = newData;
      }

      // Regular value
      else {
        let value = lines[index].substring(lines[index].indexOf(":") + 2);
        if (value.charAt(0) == "'" || value.charAt(0) == "\"")
          value = value.substring(1, value.length - 1);
        else if (!isNaN(value)) {
          if (Regex.INT.test(value)) value = parseInt(value);
          else value = parseFloat(value);
        }

        if (typeof (value) == "string") {
          if (value == "false") value = false;
          else if (value == "true") value = true;
          else value = value.replace(/\\(['"])/, ($1: string) => $1.replace("\\", ""));
        }
        this.data[key] = value;
      }

      do {
        index++;
      }
      while (index < lines.length && lines[index].replace(/ /g, "").charAt(0) == "#");

    }

    if (Object.keys(this.data).length == 1 && this.key && this.data[this.key] instanceof YAMLObject) {
      this.data = this.data[this.key].data;
    }

    return index;
  };

  public toString =
    (): string => this.toYaml(this.key || this.data.name ? "'" + (this.key || this.data.name) + "'" : undefined, this.data);

  /**
   * Creates and returns a save string for the class
   */
  public toYaml = (key: string | undefined, obj: any, spaces = ""): string => {
    if (obj instanceof YAMLObject) {
      return obj.toYaml("'" + (key ?? obj.key) + "'", obj.data, spaces);
    }

    let saveString = "";

    if (key) {
      saveString += spaces + key + ":\n";
      spaces += "  ";
    }
    for (const e of Object.keys(obj)) {
      const object = obj[e];
      const ostr: string = JSON.stringify(object);
      let str: string = spaces + e + ": " + ostr + "\n";
      if (object == undefined) continue;
      if (object instanceof Object) {
        if (Object.keys(object).includes("toYaml")) {
          if (object instanceof YAMLObject) {
            saveString += object.toYaml("'" + e + "'", object.data, spaces);
            continue;
          } else
            str = object.toYaml(spaces);
        } else if (object instanceof Array) {
          str = this.convertArray(e, spaces, object);
        }
      }

      if (str) {
        saveString +=
          str.replaceAll(/(\\)?'/g, "\\'")
            .replaceAll(/((\\)?")/g, s => s.length == 1 ? "'" : s)
            .replaceAll(/\\"/g, "\"");
      }
    }
    return saveString;
  };

  private convertArray(e: string, spaces: string, object: any[]): string {
    if (e != "attributes") {
      let str: string = spaces + e + ":";
      // If we have primitive types, we can pretty accurately parse them.
      if (["string", "number"].includes(typeof (object[0]))) {
        if (object.length > 0) {
          str += "\n";
          object.forEach(st => str += spaces + "- " + JSON.stringify(st) + "\n");
        } else {
          str += " []\n";
        }
        // Components should be able to be done with a toYaml call
      } else if (e === "components" || e === "children") {
        if (object.length == 0) {
          str += " {}\n";
        } else {
          str += "\n";
          object.forEach((obj: ProComponent) => str += this.toYaml(obj.name + "-" + uuid(), obj.toYamlObj(), spaces + "  "));
          return str.replaceAll(/'/g, "\"");
        }
        // Everything else, we'll just ignore for now.
      } else {
        str += " []\n";
      }

      return str;
    } else {
      return this.toYaml(e, object, spaces);
    }
  }

  public static deserializeComponent = (yaml: YAMLObject): ProComponent[] => {
    if (!yaml || !(yaml instanceof YAMLObject)) return [];
    const comps: ProComponent[] = [];

    const keys: string[] = yaml.getKeys();
    for (const key of keys) {
      let comp: ProComponent | undefined = undefined;
      const data = yaml.get<YAMLObject, YAMLObject>(key);
      const type = data.get("type");

      if (type === "trigger") {
        const trigger: ProComponent | undefined = Triggers.byName(key.split("-")[0]);
        if (trigger) {
          comp = trigger;
        }
        } else if (type === "condition") {
          const condition: ProComponent | undefined = Conditions.byName(key.split("-")[0]);
          if (condition) {
            comp = condition;
          }
      } else if (type === "mechanic") {
        const mechanic: ProComponent | undefined = Mechanics.byName(key.split("-")[0]);
        if (mechanic) {
          comp = mechanic;
        }
        } else if (type === "target") {
          const target: ProComponent | undefined = Targets.byName(key.split("-")[0]);
          if (target) {
            comp = target;
          }
      }

      if (comp) {
        comp.deserialize(data);
        comps.push(comp);
      }
    }

    return comps;
  };
}