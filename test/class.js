module.exports = function(first,last){
	this.first = first;
	this.last = last;
	this.full = function(){
		return this.first + " " +this.last;
	}
}