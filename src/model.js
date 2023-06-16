import { Schema } from 'src/schema';
import { Field } from 'src/field';
import { RecordSet, RecordHandler } from 'src/record';
import { NameError, DuplicationError } from 'src/errors';
import symbols from 'src/symbols';
import { standardTypes } from 'src/types';
import { validateName } from 'src/utils';

const {
  $fields,
  $properties,
  $cachedProperties,
  $methods,
  $relationships,
  $recordHandler,
  $addScope,
  $addRelationshipAsField,
  $addRelationshipAsProperty,
  $getField,
  $getProperty,
  $instances,
  $handleExperimentalAPIMessage,
} = symbols;

const allStandardTypes = [...Object.keys(standardTypes), 'enum'];

export class Model {
  #records;
  #recordHandler;
  #fields;
  #properties;
  #methods;
  #relationships;
  #cachedProperties;

  static #instances = new Map();

  constructor({
    name,
    fields = {},
    properties = {},
    methods = {},
    scopes = {},
  } = {}) {
    this.name = name;

    if (Model.#instances.has(name))
      throw new DuplicationError(`A model named ${name} already exists.`);

    // Create the record storage and handler
    this.#records = new RecordSet();
    this.#recordHandler = new RecordHandler(this);

    // Initialize private fields
    this.#fields = new Map();
    this.#properties = new Map();
    this.#methods = new Map();
    this.#relationships = new Map();
    this.#cachedProperties = new Set();

    // Add fields, checking for duplicates and invalids
    Object.entries(fields).forEach(([fieldName, field]) => {
      if (typeof field === 'object')
        this.addField({ name: fieldName, ...field });
      else this.addField({ name: fieldName, type: field });
    });

    // Add properties, checking for duplicates and invalids
    Object.entries(properties).forEach(([propertyName, property]) => {
      if (typeof property === 'object')
        this.addProperty({ name: propertyName, ...property });
      else
        this.addProperty({
          name: propertyName,
          body: property,
        });
    });

    // Add methods, checking for duplicates and invalids
    Object.entries(methods).forEach(([methodName, method]) => {
      this.addMethod(methodName, method);
    });

    // Add scopes, checking for duplicates and invalids
    Object.entries(scopes).forEach(([scopeName, scope]) => {
      this.addScope(scopeName, ...Model.#parseScope(scope));
    });

    // Add the model to the instances map
    Model.#instances.set(this.name, this);
  }

  addField(fieldOptions) {
    const { type, name } = fieldOptions;
    if (!['string', 'function'].includes(typeof type))
      throw new TypeError(`Field ${type} is not an string or a function.`);
    const isStandardType = allStandardTypes.includes(type);
    let field;

    if (isStandardType) {
      field = Field[type](fieldOptions);
    } else if (typeof type === 'function') {
      Schema[$handleExperimentalAPIMessage](
        `The provided type for ${name} is not part of the standard types. Function types are experimental and may go away in a later release.`
      );
      field = new Field(fieldOptions);
    } else {
      throw new TypeError(`Field ${type} is not a valid type.`);
    }
    this.#fields.set(name, field);
    return field;
  }

  addProperty({ name, body, cache = false }) {
    if (typeof body !== 'function')
      throw new TypeError(`Property ${name} is not a function.`);
    this.#properties.set(name, body);
    if (cache) this.#cachedProperties.add(name);
  }

  addMethod(name, method) {
    if (typeof method !== 'function')
      throw new TypeError(`Method ${name} is not a function.`);
    this.#methods.set(name, method);
  }

  addScope(name, scope, sortFn) {
    const scopeName = validateName(name);
    this.#records[$addScope](scopeName, scope, sortFn);
  }

  // TODO: V2 Enhancements
  // Connect all record events to an event emitter
  createRecord(record) {
    const [newRecordId, newRecord] = this.#recordHandler.createRecord(record);
    this.#records.set(newRecordId, newRecord);
    return newRecord;
  }

  removeRecord(recordId) {
    if (!this.#records.has(recordId)) {
      console.warn(`Record ${recordId} does not exist.`);
      return false;
    }
    this.#records.delete(recordId);
    return true;
  }

  updateRecord(recordId, record) {
    if (typeof record !== 'object')
      throw new TypeError('Record data must be an object.');
    if (!this.#records.has(recordId))
      throw new ReferenceError(`Record ${recordId} does not exist.`);
    const oldRecord = this.#records.get(recordId);
    Object.entries(record).forEach(([fieldName, fieldValue]) => {
      oldRecord[fieldName] = fieldValue;
    });
    return oldRecord;
  }

  get records() {
    return this.#records;
  }

  // Protected (package internal-use only)

  static get [$instances]() {
    return Model.#instances;
  }

  get [$recordHandler]() {
    return this.#recordHandler;
  }

  get [$fields]() {
    return this.#fields;
  }

  get [$properties]() {
    return this.#properties;
  }

  // TODO: V2 Enhancements
  // Add a method to the model, so that it's possible to reset caches for all
  // records. This removes some uncertainty and allows for recalculation without
  // hacks. Also update the docs to reflect this.
  get [$cachedProperties]() {
    return this.#cachedProperties;
  }

  get [$methods]() {
    return this.#methods;
  }

  get [$relationships]() {
    return this.#relationships;
  }

  [$addRelationshipAsField](relationship) {
    const { name, fieldName, field } = relationship[$getField]();
    const relationshipName = `${name}.${fieldName}`;
    if (
      [
        'id',
        ...this.#fields.keys(),
        ...this.#properties.keys(),
        ...this.#methods.keys(),
      ].includes(fieldName)
    )
      throw new NameError(`Relationship field ${fieldName} is already in use.`);
    if (this.#relationships.has(relationshipName))
      throw new NameError(
        `Relationship ${relationshipName} is already in use.`
      );

    this.#fields.set(fieldName, field);
    this.#relationships.set(relationshipName, relationship);
  }

  [$addRelationshipAsProperty](relationship) {
    const { name, propertyName, property } = relationship[$getProperty]();
    const relationshipName = `${name}.${propertyName}`;
    if (
      [
        'id',
        ...this.#fields.keys(),
        ...this.#properties.keys(),
        ...this.#methods.keys(),
      ].includes(propertyName)
    )
      throw new NameError(
        `Relationship property ${propertyName} is already in use.`
      );
    if (this.#relationships.has(relationshipName))
      throw new NameError(`Relationship ${name} is already in use.`);

    this.#properties.set(propertyName, property);
    this.#relationships.set(relationshipName, relationship);
  }

  // Private

  static #parseScope(scope) {
    if (typeof scope === 'function') return [scope];
    if (typeof scope === 'object') {
      const { matcher, sorter } = scope;
      if (typeof matcher !== 'function')
        throw new TypeError(
          `The provided matcher for the scope is not a function.`
        );
      if (sorter && typeof sorter !== 'function')
        throw new TypeError(
          `The provided sorter for the scope is not a function.`
        );
      return [matcher, sorter];
    }
    throw new TypeError(
      `The provided scope is not a function or valid object.`
    );
  }

  static #validateContains(modelName, objectType, objectName, objects) {
    if (!objects.has(objectName)) {
      console.warn(
        `Model ${modelName} does not contain a ${objectType.toLowerCase()} named ${objectName}.`
      );
      return false;
    }
    return true;
  }
}
