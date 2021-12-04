import {
  validateRelationshipType,
  createRelationshipField,
  reverseRelationship,
  parseModelsAndNames,
  isToOne,
  isFromOne,
  isSymmetric,
} from 'src/utils';
import symbols from 'src/symbols';

const { $key, $recordValue } = symbols;

export class Relationship {
  #type;
  #from;
  #to;
  #name; // relationship field name in the from table
  #reverseName; // relationship field name in the to table
  #relationshipField;
  #reverseRelationshipField;

  // TODO: cascade
  constructor({ from, to, type } = {}) {
    // TODO: V2 enhancements
    // Clean up and make this a little less complex?
    // Relationship receivers (to) expose a field which is essentially just a
    // a method at the time being. Could be a potential solution.
    console.warn(
      'Relationships are experimental in the current version. Please use with caution.'
    );
    this.#type = validateRelationshipType(type);
    const [fromModel, fromName, toModel, toName] = parseModelsAndNames(
      from,
      to,
      type
    );
    this.#from = fromModel;
    this.#to = toModel;
    this.#name = fromName;
    this.#reverseName = toName;

    if (
      this.#to === this.#from &&
      isSymmetric(this.#type) &&
      this.#name === this.#reverseName
    )
      throw new RangeError(
        'Relationship cannot be symmetric if the from and to models are the same and no name is provided for either one.'
      );

    // TODO: There is no actual check for validation of the relationship
    // unique, unique values in array etc.
    this.#relationshipField = createRelationshipField(
      this.#name,
      this.#type,
      this.#to[$key]
    );
    this.#reverseRelationshipField = createRelationshipField(
      this.#reverseName,
      reverseRelationship(this.#type),
      this.#from[$key]
    );
  }

  #getAssociatedRecords(record) {
    // Use a regular get for toOne relationships for performance
    if (isToOne(this.#type)) {
      const associationValue = record[this.#name];
      return this.#to.records.get(associationValue);
    }
    // Use a where query for toMany relationships, safeguard against empty value
    const associationValues = record[this.#name] || [];
    const associatedRecordsKeyName = this.#to[$key].name;
    return this.#to.records.where(associatedRecord => {
      return associationValues.includes(
        associatedRecord[associatedRecordsKeyName]
      );
    });
  }

  #getAssociatedRecordsReverse(record) {
    const associationValue = record[this.#to[$key].name];
    const matcher = isToOne(this.#type)
      ? associatedRecord => associatedRecord === associationValue
      : associatedRecord => {
          const associatedRecordValue =
            associatedRecord[$recordValue][this.#name];
          if ([undefined, null].includes(associatedRecordValue)) return false;
          return associatedRecord[$recordValue][this.#name].includes(
            associationValue
          );
        };
    // Use a regular get for fromOne relationships for performance
    if (isFromOne(this.#type)) {
      return this.#from.records.find(matcher);
    }
    // Use a where query for fromMany relationships, safeguard against empty value
    return this.#from.records.where(matcher);
  }

  get(modelName, property, record) {
    // When from model is specified, apply the relationship as-is
    if (modelName === this.#from.name && property === this.#name) {
      return this.#getAssociatedRecords(record);
    }
    // When to model is specified, reverse the relationship before applying it
    if (modelName === this.#to.name && property === this.#reverseName)
      return this.#getAssociatedRecordsReverse(record);
  }

  isReceiver(modelName, property) {
    return modelName === this.#to.name && property === this.#reverseName;
  }

  get assocation() {
    return [this.#name, this.#relationshipField];
  }

  get reverseAssocation() {
    return [this.#reverseName, this.#reverseRelationshipField];
  }

  getType(modelName, property) {
    if (modelName === this.#from.name && property === this.#name)
      return this.#type;
    if (modelName === this.#to.name && property === this.#reverseName)
      return reverseRelationship(this.#type);
  }
}

export default Relationship;
