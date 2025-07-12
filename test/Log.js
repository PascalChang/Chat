var log = {
	info: function(info){
		console.log("Info : "+info);
	},
	warnning: function(warnning){
		console.log("Warnning : "+warnning);
	},
	error: function(err){
		console.log("Error : "+err);
	}	
}

module.exports = log;