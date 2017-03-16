'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as request from 'request';
import * as fs from 'fs';

let solargraphProcess = null;
let solargraphPort = null;

const completionProvider = {
    provideCompletionItems: function completionProvider(document: vscode.TextDocument, position: vscode.Position) {
        return new Promise((resolve, reject) => {
            const kinds = {
                "Class": vscode.CompletionItemKind.Class,
                "Keyword": vscode.CompletionItemKind.Keyword,
                "Module": vscode.CompletionItemKind.Module,
                "Method": vscode.CompletionItemKind.Method,
                "Variable": vscode.CompletionItemKind.Variable,
                "Snippet": vscode.CompletionItemKind.Snippet
            }
            if (!solargraphPort) {
                return reject([]);
            }
            request.post({ url: 'http://localhost:' + solargraphPort + '/suggest', form: { filename: document.fileName, text: document.getText(), line: position.line, col: position.character }}, function(error, response, body) {
                // HACK: Tricking the type system to avoid an invalid error
                var SnippetString = vscode['SnippetString'];
                if (!error && response.statusCode == 200) {
                    if (body == "") {
                        return resolve([]);
                    } else {
                        //console.log(body);
                        let result = JSON.parse(body);
                        let items = [];
                        if (result.status == "ok") {
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
                            result.suggestions.forEach((cd) => {
                                var item = new vscode.CompletionItem(cd['label'], kinds[cd['kind']]);
                                // Treat instance variables slightly differently
                                if (cd['insert'].substring(0, 1) == '@') {
                                    item.insertText = cd['insert'].substring(1);
                                } else {
                                    item.insertText = new SnippetString(cd['insert']);
                                }
                                if (range) {
                                    // HACK: Unrecognized property
                                    item['range'] = range;
                                }
                                item.detail = cd['kind'];
                                item.documentation = cd['documentation'];
                                items.push(item);
                            });
                            return resolve(items);
                        } else {
                            return resolve([]);
                        }
                    }
                }
            });
        });
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'ruby', completionProvider, "."
        )
    );

    var isWin = /^win/.test(process.platform);

    // Start the Solargraph server
    var cmd = ['solargraph', 'server'];
    var cwd = null;
    if (vscode.workspace.rootPath) {
        // TODO: Check for a gemfile
        cmd.unshift('bundle', 'exec');
        cwd = vscode.workspace.rootPath;
    }
    if (isWin) {
        cmd.unshift('powershell');
    }
    solargraphProcess = child_process.spawn(cmd.shift(), cmd, { cwd: cwd });
    solargraphProcess.stderr.on('data', (data) => {
        console.log('[stderr from Solargraph server] ' + data);
        var match = data.toString().match(/port=([0-9]*)/);
        if (match) {
            solargraphPort = match[1];
        }
    });
    solargraphProcess.stdout.on('data', (data) => {
        console.log('[stdout from Solargraph server] ' + data);
    });

    // Document gems
    cmd = ['yard', 'gems'];
    if (vscode.workspace.rootPath) {
        cmd.unshift('bundle', 'exec');        
    }
    if (isWin) {
        cmd.unshift('powershell');
    }
    child_process.spawn(cmd.shift(), cmd, { cwd: cwd });

    console.log('Solargraph extension activated.');
}

export function deactivate() {
    console.log('Deactivating extension');
    solargraphProcess.kill();
}
