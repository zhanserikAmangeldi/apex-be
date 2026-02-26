import * as Y from 'yjs';

/**
 * Extract document link IDs from a Yjs document
 */
export function extractDocumentLinks(doc) {
    try {
        const fragment = doc.getXmlFragment('default');
        const links = [];

        function traverse(node) {
            if (!node) return;

            if (node.nodeName === 'documentLink') {
                const attrs = node.getAttributes ? node.getAttributes() : {};
                if (attrs.id) {
                    links.push(attrs.id);
                }
            }

            if (node instanceof Y.XmlFragment || node instanceof Y.XmlElement) {
                const len = node.length || 0;
                for (let i = 0; i < len; i++) {
                    traverse(node.get(i));
                }
            }
        }

        traverse(fragment);
        return [...new Set(links)]; // deduplicate
    } catch (error) {
        console.error('Error extracting document links:', error);
        return [];
    }
}
