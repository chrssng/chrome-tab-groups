[← Documentation](README.md)

# Categories

Categories sort your groups into sections – e.g. *Work*, *Reading*, *Private*. Every group belongs to exactly one category.

## The “Default” category

There is always at least one category. After installing – or with settings from an older version – it's **Default**, and all groups are in it. You can rename it like any other category.

## Managing categories

In the settings, every category is a tinted frame – marked with a folder icon – that contains its groups. Its header:

| In the header | |
|---|---|
| ⌄ | Collapse or expand the category – see [Collapsing](#collapsing) |
| **Name** | Required, at most 40 characters, unique (upper/lower case doesn't count) |
| *3 groups* | How many groups the category contains |
| **Active / Paused / Mixed** | Turns all groups of the category on or off at once. *Mixed* = some are paused. Hidden while the category is empty. |
| **Open all** | Opens all groups of the category – see [Opening a whole category](open-group.md#opening-a-whole-category) |
| ⇕ | Collapses all group cards of the category – or, if all are collapsed, expands them |
| **+** | Adds a new group to this category |
| **↑ ↓** | Moves the whole category up or down |
| Trash can | Deletes the category |

- **Add category** (below the list) appends a new, empty category. Give it a name before saving.
- **Deleting a category** doesn't delete its groups: they join the category **above** it (at its end) – or, if it was the first one, the category **below** it (at its start). So the order of all groups stays the same. If that category is collapsed, it stays collapsed and is briefly highlighted. The **last category can't be deleted**.
- If two groups with the same name end up in one category that way, the name is marked as an error until you rename one.

As always, nothing is saved until you click **Save** – **Discard** undoes everything.

## Putting a group into a category

- **Category** field of the group – the group moves to the end of the chosen category.
- **Drag** the group by its header onto another category – onto a group there, onto the category's header or onto an empty category. A collapsed category stays collapsed and is briefly highlighted.
- **+** in a category's header creates the new group right there. **Add group** below the list adds it to the last category.
- A new group created in the [popup](popup.md#assign-a-domain) goes into the category you choose there.

## Names

A group name only has to be unique **within its category**. *Docs* in *Work* and *Docs* in *Reading* is fine; two *Docs* in *Work* is an error.

## Priority

The list is checked **from top to bottom** – the categories in their order, and within each category its groups in their order. The number in each group's header is its priority across the whole list.

So the order of the categories matters too: a general group (e.g. *Google* with `google.com`) in a category at the bottom never takes URLs away from more specific groups in the categories above. To let a group win against a group of another category, move its category up – or move the group into that category above the other one. See [Which group wins](url-patterns.md#which-group-wins).

## The category in the tab title

Each group has the option **Show the category in the tab title** (off by default). When it's on, the tab group is titled *Category · Name* – e.g. *Reading · Docs* – instead of just *Docs*.

If you rename a category, open tab groups that show it are renamed right away.

### Groups with the same title

Two groups with the same name in different categories – both without the category in their title – get the **same title** in the tab strip. The extension still keeps them apart:

- It remembers which tab group it created for which group, as long as Chrome is running.
- After Chrome was restarted, it can only tell them apart by their **color**.

That's why the settings page warns you: *The group “Docs” in “Reading” has the same title in the tab strip.* To be on the safe side, give such groups **different colors** – or turn on **Show the category in the tab title** for at least one of them.

## Collapsing

On the settings page you can collapse:

- **a category** – with ⌄ in its header; only the header stays visible
- **a group** – with ⌄ in its header; only the header with the preview, the Active/Paused switch and the buttons stays visible. A group with errors gets a red border, so you notice it even when it's collapsed.
- **all groups of a category** – with ⇕ in the category's header
- **all categories** – with **Collapse all** / **Expand all** at the top right of the list

Collapsing only changes the view: it's remembered on this computer, but not saved with your settings and not synced.

A collapsed category is only expanded automatically when you need to see something in it: when you add a group to it, when you choose it in a group's **Category** field, when you expand all of its groups, or when saving fails because of an error in it – then the group with the first error is expanded, too.

## In the popup

As soon as your groups are spread over several categories, the popup shows each category as its own block – with a folder icon and the category's name, its groups inside, and **Open all** for categories with more than one group.

Under **Current tab**, the category is shown as well: *Belongs to* **GitHub** *in* **Work** – unless the group's title already contains it. The list for **Assign domain** is sorted by category, and a new group gets a category right there. See [The popup](popup.md).
