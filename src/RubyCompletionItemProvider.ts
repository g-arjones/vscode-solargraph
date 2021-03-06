import * as vscode from 'vscode';
import * as solargraph from 'solargraph-utils';
import * as format from './format';
import * as helper from './helper';

export default class RubyCompletionItemProvider implements vscode.CompletionItemProvider {
	private server:solargraph.Server = null;

	constructor(server:solargraph.Server) {
		this.server = server;
	}

	static kinds = {
		"Class": vscode.CompletionItemKind.Class,
		"Constant": vscode.CompletionItemKind.Constant,
		"Keyword": vscode.CompletionItemKind.Keyword,
		"Module": vscode.CompletionItemKind.Module,
		"Method": vscode.CompletionItemKind.Method,
		"Variable": vscode.CompletionItemKind.Variable,
		"Snippet": vscode.CompletionItemKind.Snippet,
		"Field": vscode.CompletionItemKind.Field,
		"Property": vscode.CompletionItemKind.Property
	}

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position):Promise<vscode.CompletionItem[]> {
		var that = this;
		return new Promise((resolve, reject) => {
			var workspace = helper.getDocumentWorkspaceFolder(document);
			this.server.suggest(document.getText(), position.line, position.character, document.fileName, workspace).then(function(response) {
				if (response['status'] == 'ok') {
					resolve(that.getCompletionItems(response, document, position));
				} else {
					console.warn('Solargraph server returned an error: ' + response['message']);
					reject([]);
				}
			});
		});
	}

	public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken):Promise<vscode.CompletionItem> {
		return new Promise((resolve, reject) => {
			if (item.documentation && item.documentation != 'Loading...') {
				resolve(item);
			} else if (item.documentation == 'Loading...') {
				var workspaceFolder = vscode.workspace.getWorkspaceFolder(item['textDocument'].uri);
				var workspace = (workspaceFolder ? workspaceFolder.uri.fsPath : vscode.workspace.rootPath);
				console.log('Getting stuff from ' + workspace);
				this.server.resolve(item['original']['path'], workspace).then((result:any) => {
					if (result.suggestions.length > 0) {
						var tmp = this.formatMultipleSuggestions(result.suggestions);
						if (tmp.value != '') {
							item.documentation = tmp;
						}
					} else {
						item.documentation = '';
					}
					resolve(item);
				}).catch((result) => {
					reject(result);
				});
			} else {
				resolve(item);
			}
		});
	}

	private getCompletionItems(data, document:vscode.TextDocument, position: vscode.Position):Array<vscode.CompletionItem> {
		let SnippetString = vscode.SnippetString;
		let items:Array<vscode.CompletionItem> = [];
		if (data.status == "ok") {
			var range = document.getWordRangeAtPosition(position);
			if (range) {
				var repl = document.getText(range);
				if (range.start.character > 0) {
					if (repl.substr(0, 1) == ':') {
						var prevChar = document.getText(new vscode.Range(range.start.line, range.start.character - 1, range.start.line, range.start.character));
						if (prevChar == ':') {
							// Replacement range starts with a colon, but there's
							// a previous colon. That means we're in a namespace,
							// not a symbol. Get rid of the colon in the namespace
							// range.
							range = new vscode.Range(range.start.line, range.start.character + 1, range.end.line, range.end.character);
						}
					}
				}
			}
			data.suggestions.forEach((cd) => {
				var item = new vscode.CompletionItem(cd['label'], RubyCompletionItemProvider.kinds[cd['kind']]);
				// Treat instance variables slightly differently
				if (cd['insert'].substring(0, 1) == '@') {
					var firstChar = 1;
					if (cd['insert'].substring(1, 2) == '@') {
						firstChar = 2;
					}
					item.insertText = cd['insert'].substring(firstChar);
					item.filterText = cd['insert'].substring(firstChar);
					item.sortText = cd['insert'].substring(firstChar);
				} else if (cd['insert'].substring(0, 1) == '$') {
					item.insertText = cd['insert'].substring(1);
					item.filterText = cd['insert'].substring(1);
					item.sortText = cd['insert'].substring(1);					
				} else {
					if (cd['kind'] == 'Snippet') {
						item.insertText = new SnippetString(cd['insert']);
					} else {
						// HACK: Exception for symbols starting with underscores (e.g., `:_foo`)
						var match = cd['insert'].match(/^:_/);
						if (match) {
							item.insertText = cd['insert'].substring(match[0].length);
							item.filterText = cd['insert'].substring(match[0].length);
							item.sortText = cd['insert'].substring(match[0].length);
						} else {
							item.insertText = cd['insert'];
						}
					}
				}
				if (range) {
					item.range = range;
				}
				if (cd['kind'] == 'Method' && cd['arguments'].length > 0) {
					item.detail = '(' + cd['arguments'].join(', ') + ') ' + (cd['return_type'] ? '=> ' + cd['return_type'] : '');
				} else {
					item.detail = (cd['return_type'] ? '=> ' + cd['return_type'] : '');
				}
				if (cd['documentation']) {
					this.setDocumentation(item, cd);
				} else if (cd['has_doc']) {
					item.documentation = 'Loading...';
				} else {
					item.documentation = "\n" + cd['path'];
				}
				item['original'] = cd;
				item['textDocument'] = document;
				items.push(item);
			});
		}
		return items;
	}

	private formatMultipleSuggestions(cds: any[]) {
		var doc = '';
		var docLink = '';
		cds.forEach((cd) => {
			if (!docLink && cd.path) {
				docLink = "\n\n" + helper.getDocumentPageLink(cd.path) + "\n\n";
			}
			doc += "\n" + format.htmlToPlainText(cd.documentation);
		});
		return this.formatDocumentation(docLink + doc);
	}

	private setDocumentation(item: vscode.CompletionItem, cd: any) {
		var docLink = '';
		if (cd['path']) {
			docLink = "\n\n" + helper.getDocumentPageLink(cd.path) + "\n\n";
		}
		var doc = docLink + format.htmlToPlainText(cd['documentation']);
		if (cd['params'] && cd['params'].length > 0) {
			doc += "\nParams:\n";
			for (var j = 0; j < cd['params'].length; j++) {
				doc += "- " + cd['params'][j] + "\n";
			}
		}
		var md = this.formatDocumentation(doc);
		item.documentation = md;
	}

	private formatDocumentation(doc: string): vscode.MarkdownString {
		var md = new vscode.MarkdownString(doc);
		md.isTrusted = true;
		return md;		
	}
}
