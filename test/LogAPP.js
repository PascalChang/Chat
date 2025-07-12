var log = require("./Log.js");
var messages = require("./Messages.js");
log.info("NodeJs Test");
console.log(messages.simple("123"));
console.log(messages.go.first+" "+messages.go.last);
//messages("Just fun");

var person = require("./class.js");
var person1 = new person("Pascal","Chang")
console.log(person1.full());
var person2 = new person("Lisa", "Chen");
console.log(person2.full());
var date = require("./date.js")
console.log(date.now());