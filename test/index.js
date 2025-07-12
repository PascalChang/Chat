var express = require("express");
var app = express();
app.get("/",function(req,res){
	res.send("Hello <h1>world</h1>.")
	
});

app.get("/mypath",function(req,res){
	res.send("You are in mypath");
	
});

app.listen(3000, function(){
	console.log("Is connected.");
});