pandoc -s --toc --from=markdown --to=html --output=vzfs_docs.html --metadata title="VZFS | Docs" README.md 

pandoc -s --toc --from=markdown --to=html --output=index.html --metadata title="Publications" index.md 
