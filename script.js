/*
 * Copyright (C) 2016 Opsmate, Inc.
 * 
 * This Source Code Form is subject to the terms of the Mozilla
 * Public License, v. 2.0. If a copy of the MPL was not distributed
 * with this file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * 
 * This software is distributed WITHOUT A WARRANTY OF ANY KIND.
 * See the Mozilla Public License for details.
 */
function init_caa_helper (form, output, output_zonefile, output_rfc3597, output_tinydns, output_generic) {
	function aggregate (input_name) {
		var items = [];
		var inputs = form[input_name];
		for (var i = 0; i < inputs.length; ++i) {
			if (inputs[i].checked && !inputs[i].disabled) {
				items.push(inputs[i].value);
			}
		}
		return items;
	}
	function array_equals (a, b) {
		if (a.length != b.length) {
			return false;
		}
		for (var i = 0; i < a.length; ++i) {
			if (a[i] != b[i]) {
				return false;
			}
		}
		return true;
	}
	function ensure_trailing_dot (str) {
		if (str.substr(-1) != ".") {
			return str + ".";
		} else {
			return str;
		}
	}
	function strip_trailing_dot (str) {
		if (str.substr(-1) == ".") {
			return str.substr(0, str.length - 1);
		} else {
			return str;
		}
	}
	function quote (str) {
		return '"' + str.replace(/\"/g, "\\\"") + '"';
	}
	function make_unknown_record (bytes) {
		var str = "\\# " + bytes.length + " ";
		for (var i = 0; i < bytes.length; ++i) {
			var hexStr = bytes[i].toString(16).toUpperCase();
			if (hexStr.length == 1) {
				str += "0";
			}
			str += hexStr;
		}
		return str;
	}
	function make_tinydns_generic_record (bytes) {
		var str = "";
		for (var i = 0; i < bytes.length; ++i) {
			str += "\\";
			var octalStr = bytes[i].toString(8);
			if (octalStr.length == 1) {
				str += "00";
			} else if (octalStr.length == 2) {
				str += "0";
			}
			str += octalStr;
		}
		return str;
	}
	function Record (flags, tag, value) {
		this.flags = flags;
		this.tag = tag;
		this.value = value;

		this.format = function () {
			return this.flags + " " + this.tag + " " + quote(this.value);
		};
		this.encode = function () {
			var i;
			var bytes = [];
			bytes.push(this.flags);
			bytes.push(this.tag.length);
			for (i = 0; i < this.tag.length; ++i) {
				bytes.push(this.tag.charCodeAt(i));
			}
			for (i = 0; i < this.value.length; ++i) {
				bytes.push(this.value.charCodeAt(i));
			}
			return bytes;
		};
	}
	function decode_record (bytes) {
		function decode_string (bytes) {
			var str = "";
			for (var i = 0; i < bytes.length; ++i) {
				str += String.fromCharCode(bytes[i]);
			}
			return str;
		}

		if (bytes.length < 2) {
			return null;
		}
		var flags = bytes[0];
		var tag_len = bytes[1];
		var tag = decode_string(bytes.slice(2, 2 + tag_len));
		var value = decode_string(bytes.slice(2 + tag_len));
		return new Record(flags, tag, value);
	}
	function iodef_from_form (value) {
		if (value == "" || value.indexOf("mailto:") == 0 || value.indexOf("http:") == 0 || value.indexOf("https:") == 0) {
			return value;
		} else {
			return "mailto:" + value;
		}
	}
	function iodef_to_form (value) {
		if (value.indexOf("mailto:") == 0) {
			return value.substr(7);
		} else {
			return value;
		}
	}
	function Policy (issue, issuewild, iodef) {
		this.issue = issue;
		this.issuewild = issuewild;
		this.iodef = iodef;

		this.make_records = function () {
			var records = [];
			var i;
			if (this.issue.length == 0) {
				records.push(new Record(0, "issue", ";"));
			} else {
				for (i = 0; i < this.issue.length; ++i) {
					records.push(new Record(0, "issue", this.issue[i]));
				}
			}
			if (!array_equals(this.issue, this.issuewild)) {
				if (this.issuewild.length == 0) {
					records.push(new Record(0, "issuewild", ";"));
				} else {
					for (i = 0; i < this.issuewild.length; ++i) {
						records.push(new Record(0, "issuewild", this.issuewild[i]));
					}
				}
			}
			if (this.iodef != "") {
				records.push(new Record(0, "iodef", this.iodef));
			}
			return records;
		};
		this.to_form = function () {
			function set_checkboxes (input_name, items) {
				var inputs = form[input_name];
				for (var i = 0; i < inputs.length; ++i) {
					if (!inputs[i].disabled) {
						inputs[i].checked = items.indexOf(inputs[i].value) != -1;
					}
				}
			}
			set_checkboxes("issue", this.issue);
			set_checkboxes("issuewild", this.issuewild);
			form["iodef"].value = iodef_to_form(this.iodef);
		};
	}
	function make_policy_from_form () {
		return new Policy(aggregate("issue"), aggregate("issuewild"), iodef_from_form(form["iodef"].value));
	}
	function InvalidRecordError (message) {
		this.message = message;
	}
	function PolicyCompatError (message) {
		this.message = message;
	}
	function make_policy_from_records (records) {
		function parse_issue_property (str) {
			var re = /^[ \t]*([-.0-9a-zA-Z]*)[ \t]*(;(([ \t]*[0-9a-zA-Z]+=[\x21-\x7E]*)*)[ \t]*)?$/;
			var m = re.exec(str);
			if (!m) {
				throw new InvalidRecordError("The issue or issuewild property is malformed");
			}
			if (m[3] && m[3] != "") {
				throw new PolicyCompatError("issue and issuewild parameters are not supported");
			}
			return m[1];
		}

		var has_issue = false;
		var issue = [];
		var has_issuewild = false;
		var issuewild = [];
		var iodef = "";

		for (var i = 0; i < records.length; ++i) {
			var record = records[i];
			if (record.tag == "issue") {
				var domain = parse_issue_property(record.value);
				if (domain != "") {
					issue.push(domain);
				}
				has_issue = true;
			} else if (record.tag == "issuewild") {
				var domain = parse_issue_property(record.value);
				if (domain != "") {
					issuewild.push(domain);
				}
				has_issuewild = true;
			} else if (record.tag == "iodef") {
				if (iodef != "") {
					throw new PolicyCompatError("At most one iodef property is supported");
				}
				iodef = record.value;
			} else {
				throw new PolicyCompatError("The " + record.tag + " property is not supported (only issue, issuewild, and iodef are supported)");
			}
		}

		if (!has_issue) {
			if (has_issuewild || iodef != "") {
				throw new PolicyCompatError("Policies without at least one issue property are not supported");
			}
			return null;
		}

		return new Policy(issue, has_issuewild ? issuewild : issue, iodef);
	}
	function set_output (output, elts) {
		while (output.hasChildNodes()) {
			output.removeChild(output.firstChild);
		}
		for (var i = 0; i < elts.length; ++i) {
			output.appendChild(elts[i]);
		}
	}
	function format_zone_file (domain, records) {
		var text = "";
		for (var i = 0; i < records.length; ++i) {
			text += domain + "\tIN\tCAA\t" + records[i].format() + "\n";
		}
		return text;
	}
	function format_rfc3597_zone_file (domain, records) {
		var text = "";
		for (var i = 0; i < records.length; ++i) {
			text += domain + "\tIN\tTYPE257\t" + make_unknown_record(records[i].encode()) + "\n";
		}
		return text;
	}
	function format_tinydns_zone_file (domain, records) {
		// see https://cr.yp.to/djbdns/tinydns-data.html
		// see https://github.com/SSLMate/caa_helper/issues/21#issuecomment-293424734
		// :example.com:257:\000\005\151\163\163\165\145\143\157\155\157\144\157\143\141\056\143\157\155
		var text = "";
		for (var i = 0; i < records.length; ++i) {
			text += ":" + strip_trailing_dot(domain) + ":257:" + make_tinydns_generic_record(records[i].encode()) + "\n";
		}
		return text;
	}
	function create_zonefile_config (domain, records) {
		return [ document.createTextNode(format_zone_file(domain, records)) ];
	}
	function create_rfc3597_config (domain, records) {
		return [ document.createTextNode(format_rfc3597_zone_file(domain, records)) ];
	}
	function create_tinydns_config (domain, records) {
		return [ document.createTextNode(format_tinydns_zone_file(domain, records)) ];
	}
	function create_generic_config (domain, records) {
		var elts = [];
		for (var i = 0; i < records.length; ++i) {
			var li = document.createElement("li");
			var span = document.createElement("span");
			span.appendChild(document.createTextNode(records[i].format()));
			li.appendChild(span);
			elts.push(li);
		}
		return elts;
	}
	function display_records (domain, records) {
		set_output(output_zonefile, create_zonefile_config(domain, records));
		set_output(output_rfc3597, create_rfc3597_config(domain, records));
		set_output(output_tinydns, create_tinydns_config(domain, records));
		set_output(output_generic, create_generic_config(domain, records));
		output.style.display = "block";
	}
	function hide_output () {
		output.style.display = "none";
	}
	function refresh () {
		var domain = form["domain"].value;
		if (domain != "") {
			display_records(ensure_trailing_dot(domain), make_policy_from_form().make_records());
		} else {
			hide_output();
		}
	}

	for (var i = 0; i < form.elements.length; ++i) {
		var elt = form.elements[i];
		if (elt.name == "issue" || elt.name == "issuewild") {
			elt.onclick = refresh;
		}
		if (elt.name == "domain" || elt.name == "iodef") {
			elt.onchange = refresh;
			elt.onkeyup = refresh;
		}
	}

	refresh();
}
