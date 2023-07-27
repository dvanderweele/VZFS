https://dzone.com/articles/materialized-paths-tree-structures-relational-database

To efficiently resolve provided paths in a tree structure stored in a single IndexedDB object store, you can use an indexing strategy known as "Materialized Path" or "Path Enumeration". This strategy allows you to represent the entire path from the root to a leaf node as a single value in the database.

Here's how you can implement this strategy:

Store each node of the tree as a separate record in the object store.
Add an additional indexed field in each record to store the path from the root to that node. This can be a string or an array of strings representing the path. For example, if the root node has a path of "root", and a child node's path is "root/child1/child2", then you would store "root/child1/child2" in the indexed field.
When inserting or updating a node, make sure to update the path field accordingly. If a node is moved or its parent is changed, update the path field of that node and all its descendants.
To resolve a provided path, you can use IndexedDB's index feature. Create an index on the path field to efficiently query for specific paths. The index will allow you to perform a range query to retrieve all nodes that have a path that matches or starts with the provided path.
Use the retrieved nodes to reconstruct the tree structure based on the path information stored in each node.
By using this approach, you can efficiently resolve provided paths in the tree structure by leveraging IndexedDB's indexing capabilities.