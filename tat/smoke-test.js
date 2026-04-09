const { parseTat, printTatAst } = require("./dist");

const source = `
hero = <{ id: "hero", type: "character", name: "Aria" }>

export { hero }
`;

const result = parseTat(source);

console.log(result.tokens.length);
console.log(result.ast.type);
console.log(printTatAst(source));