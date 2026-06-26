export function getUniqueName(name: string, otherNames: string[]): string {
    let newName = name;
    let counter = 1;
    while (otherNames.includes(newName)) {
        newName = `${name} (${counter})`;
        counter++;
    }
    return newName;
}