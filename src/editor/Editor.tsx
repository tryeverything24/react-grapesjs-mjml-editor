// src/editor/Editor.tsx
import { useCallback, useEffect, useRef } from 'react';
import grapesjs, { type Component as GjsComponent, type Editor as GrapesEditor } from 'grapesjs';
import GjsEditor, { Canvas, WithEditor } from '@grapesjs/react';
import mjmlPlugin from 'grapesjs-mjml';

import Topbar from './components/Topbar';
import LeftSidebar from './components/LeftSidebar';
import RightSidebar from './components/RightSidebar';
import { sanitizeMjmlMarkup } from './utils/mjml';
import { deepSanitize, sanitizeComponentAttributes, sanitizeComponentStyles } from './sanitizeAttributes';
// import registerPrebuiltBlocks from './plugins/registerPrebuiltBlocks'; // used when uncommenting block registration below

// ✅ ADD THIS IMPORT my_IMPORT one line
import { fixMjWrapper } from './patches/fixMjWrapper';

import 'grapesjs/dist/css/grapes.min.css';
import './editor.css';

export default function Editor() {
  const editorRef = useRef<GrapesEditor | null>(null);

  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) {
        editor.destroy();
        editorRef.current = null;
      }
    };
  }, []);

  const handleEditorReady = useCallback((editor: GrapesEditor) => {
    editorRef.current = editor;

     // ✅ APPLY THE PATCH ASAP (safe to call multiple times) my_IMPORT one line
    fixMjWrapper(editor);

    (window as unknown as { editor?: GrapesEditor }).editor = editor;
    console.log('Editor loaded with React UI');

    editor.on('load', () => {
      type BlockCategoryModel = {
        set?: (key: string, value: unknown) => void;
        open?: unknown;
      };

      const toCategoryArray = (collection: unknown): BlockCategoryModel[] => {
        if (!collection) {
          return [];
        }

        if (Array.isArray(collection)) {
          return collection as BlockCategoryModel[];
        }

        if (typeof collection === 'object') {
          const record = collection as Record<string, unknown>;
          const maybeModels = record.models;

          if (Array.isArray(maybeModels)) {
            return maybeModels as BlockCategoryModel[];
          }

          const maybeToArray = record.toArray as (() => unknown) | undefined;
          if (typeof maybeToArray === 'function') {
            const arrayResult = maybeToArray.call(collection) as unknown;
            if (Array.isArray(arrayResult)) {
              return arrayResult as BlockCategoryModel[];
            }
          }
        }

        return [];
      };

      const categories = toCategoryArray(editor.Blocks.getCategories?.());

      categories.forEach((category, index) => {
        const shouldOpen = index === 0;

        if (typeof category.set === 'function') {
          category.set('open', shouldOpen);
          return;
        }

        if ('open' in category) {
          category.open = shouldOpen;
        }
      });
    });

    const wrapperComponent = editor.DomComponents.getWrapper();
    if (wrapperComponent) {
      deepSanitize(wrapperComponent);
    }

    type UnknownComponent = {
      set?: (props: Record<string, unknown>) => void;
      findType?: (type: string) => unknown[];
      append?: (component: unknown, options?: Record<string, unknown>) => unknown;
      move?: (target: unknown, options?: Record<string, unknown>) => unknown;
      components?: () => unknown;
      parent?: () => UnknownComponent | null | undefined;
      get?: (prop: string) => unknown;
      remove?: (options?: Record<string, unknown>) => void;
    };

    let isRestoringMjBody = false;
    let isRoutingComponentIntoBody = false;

    const getComponentType = (component: UnknownComponent | null | undefined) =>
      ((component?.get?.('type') as string | undefined) ??
        (component?.get?.('tagName') as string | undefined) ??
        '').toLowerCase();

    const toComponentArray = (collection: unknown): UnknownComponent[] => {
      if (!collection) {
        return [];
      }

      if (Array.isArray(collection)) {
        return collection as UnknownComponent[];
      }

      if (typeof collection === 'object') {
        const record = collection as Record<string, unknown>;
        const maybeModels = record.models;

        if (Array.isArray(maybeModels)) {
          return maybeModels as UnknownComponent[];
        }

        const maybeToArray = record.toArray as (() => unknown) | undefined;
        if (typeof maybeToArray === 'function') {
          const arrayResult = maybeToArray.call(collection) as unknown;
          if (Array.isArray(arrayResult)) {
            return arrayResult as UnknownComponent[];
          }
        }
      }

      return [];
    };

    const removeIfEmptyDiv = (candidate?: UnknownComponent | null) => {
      if (!candidate) {
        return;
      }

      const type = getComponentType(candidate);
      const tagName = (candidate.get?.('tagName') as string | undefined)?.toLowerCase();

      if (type !== 'div' && tagName !== 'div') {
        return;
      }

      const children = toComponentArray(candidate.components?.());
      if (children.length > 0) {
        return;
      }

      const rawContent = candidate.get?.('content');
      if (typeof rawContent === 'string' && rawContent.trim().length > 0) {
        return;
      }

      if (rawContent && typeof rawContent !== 'string') {
        return;
      }

      candidate.remove?.({ temporary: true });
    };

    const cleanupWrapperChildren = (wrapper?: UnknownComponent | null) => {
      if (!wrapper) {
        return;
      }

      toComponentArray(wrapper.components?.()).forEach(removeIfEmptyDiv);
    };

    const headOnlyComponentTypes = new Set([
      'mj-head',
      'mj-title',
      'mj-preview',
      'mj-style',
      'mj-font',
      'mj-attributes',
      'mj-html',
    ]);

    const lockRootComponents = () => {
      const wrapperComponent = editor.getWrapper() as UnknownComponent | null;

      if (!wrapperComponent) {
        return;
      }

      cleanupWrapperChildren(wrapperComponent);

      wrapperComponent.set?.({
        removable: false,
        draggable: false,
        copyable: false,
        badgable: false,
      });

      cleanupWrapperChildren(wrapperComponent);

      const bodyComponents = wrapperComponent.findType?.('mj-body');

      if (!Array.isArray(bodyComponents)) {
        return;
      }

      bodyComponents.forEach((bodyComponent) => {
        (bodyComponent as UnknownComponent).set?.({
          removable: false,
          draggable: false,
        });
      });
    };

    const ensureMjBodyPresence = () => {
      if (isRestoringMjBody || isRoutingComponentIntoBody) {
        return;
      }

      const wrapperComponent = editor.getWrapper() as UnknownComponent | null;

      if (!wrapperComponent) {
        return;
      }

      cleanupWrapperChildren(wrapperComponent);

      const existingBodies = wrapperComponent.findType?.('mj-body');

      if (Array.isArray(existingBodies) && existingBodies.length > 0) {
        lockRootComponents();
        return;
      }

      isRestoringMjBody = true;

      try {
        const mjmlComponents = wrapperComponent.findType?.('mjml');
        const mjmlComponent = Array.isArray(mjmlComponents)
          ? (mjmlComponents[0] as UnknownComponent | undefined)
          : undefined;

        if (mjmlComponent && typeof mjmlComponent.append === 'function') {
          mjmlComponent.append({ type: 'mj-body' });
        } else {
          editor.setComponents('<mjml><mj-body></mj-body></mjml>');
        }
      } finally {
        isRestoringMjBody = false;
      }

      lockRootComponents();
    };

    const ensureComponentInMjBody = (component: UnknownComponent) => {
      if (isRestoringMjBody || isRoutingComponentIntoBody) {
        return;
      }

      const componentType = getComponentType(component);

      if (!componentType.startsWith('mj-')) {
        return;
      }

      if (
        componentType === 'mj-body' ||
        componentType === 'mjml' ||
        headOnlyComponentTypes.has(componentType)
      ) {
        return;
      }

      const parentComponent = component.parent?.() ?? null;
      const parentType = getComponentType(parentComponent);
      const isDivUnderRoot =
        parentType === 'div' &&
        (() => {
          const ancestorType = getComponentType(parentComponent?.parent?.() ?? null);
          return ancestorType === 'wrapper' || ancestorType === 'mjml';
        })();

      if (parentType !== 'wrapper' && parentType !== 'mjml' && !isDivUnderRoot) {
        return;
      }

      const wrapperComponent = editor.getWrapper() as UnknownComponent | null;

      if (!wrapperComponent) {
        return;
      }

      let bodyComponents = wrapperComponent.findType?.('mj-body');

      if (!Array.isArray(bodyComponents) || bodyComponents.length === 0) {
        ensureMjBodyPresence();
        bodyComponents = wrapperComponent.findType?.('mj-body');
      }

      if (!Array.isArray(bodyComponents) || bodyComponents.length === 0) {
        return;
      }

      const bodyComponent = bodyComponents[0] as UnknownComponent;

      if (parentComponent === bodyComponent) {
        return;
      }

      const appendFn =
        typeof bodyComponent.append === 'function'
          ? bodyComponent.append.bind(bodyComponent)
          : null;
      const moveFn =
        typeof component.move === 'function' ? component.move.bind(component) : null;

      if (!appendFn && !moveFn) {
        return;
      }

      const bodyCollection = bodyComponent.components?.() as
        | { length?: number }
        | undefined;
      const insertionIndex =
        typeof bodyCollection?.length === 'number' ? bodyCollection.length : undefined;
      const moveOptions =
        typeof insertionIndex === 'number' ? { at: insertionIndex } : undefined;

      isRoutingComponentIntoBody = true;

      try {
        if (moveFn) {
          moveFn(bodyComponent, moveOptions);
        } else if (appendFn) {
          if (typeof component.remove === 'function') {
            component.remove({ temporary: true });
          }

          if (typeof insertionIndex === 'number') {
            appendFn(component, {
              at: insertionIndex,
            });
          } else {
            appendFn(component);
          }
        }
      } finally {
        isRoutingComponentIntoBody = false;
      }

      removeIfEmptyDiv(parentComponent);

    };

    ensureMjBodyPresence();

    let allowStarterTemplateInjection = true;

const initialTemplate = [
  '<mjml>',
  '  <mj-body background-color="#F5F5F5" width="600px">',
  '',
  '    <!-- OUTER WRAPPER -->',
  '    <mj-wrapper background-color="#F5F5F5" padding="24px 20px" full-width="full-width">',
  '',
  '      <!-- BRAND HEADER WITH LOGO -->',
  '      <mj-section background-color="#86BD40" padding="16px 24px">',
  '        <mj-column width="120px">',
  '          <mj-image src="https://cdn-icons-png.flaticon.com/512/5968/5968705.png" width="40px" padding="0" alt="Logo" />',
  '        </mj-column>',
  '        <mj-column>',
  '          <mj-text align="center" color="#FFFFFF" font-size="14px" padding="0">',
  '            Welcome to your custom GrapesJS + MJML email builder',
  '          </mj-text>',
  '          <mj-text align="center" color="#FFFFFF" font-size="14px" padding="0">',
  '            (Erkinbek)',
  '          </mj-text>',
  '        </mj-column>',
  '      </mj-section>',
  '',
  '      <mj-section background-color="#FFFFFF" padding="40px 24px">',
  '        <mj-column>',
  '          <mj-text font-size="26px" font-weight="700" padding="0 0 12px">',
  '            Build Beautiful Emails Faster',
  '          </mj-text>',
  '          <mj-text padding="0 0 20px">',
  '            Design responsive campaigns visually and export clean MJML-powered HTML ready for production.',
  '          </mj-text>',
  '          <mj-button background-color="#86BD40" color="#FFFFFF" href="#">',
  '            Start Designing',
  '          </mj-button>',
  '        </mj-column>',
  '      </mj-section>',
  '',
  '      <!-- TWO COLUMN FEATURE BLOCK WITH ICONS -->',
  '      <mj-section background-color="#FFFFFF" padding="30px 24px">',
  '        <mj-column width="50%">',
  '          <mj-text font-weight="600" padding="0 0 8px">',
  '            Drag & Drop Blocks',
  '          </mj-text>',
  '          <mj-text>',
  '            Easily customize layouts, duplicate sections, and rearrange content visually.',
  '          </mj-text>',
  '        </mj-column>',
  '',
  '        <mj-column width="50%">',
  '          <mj-text font-weight="600" padding="0 0 8px">',
  '            Clean MJML Output',
  '          </mj-text>',
  '          <mj-text>',
  '            Export optimized, responsive HTML emails compatible with major clients.',
  '          </mj-text>',
  '        </mj-column>',
  '      </mj-section>',
  '',
  '      <!-- IMAGE + TEXT BLOCK -->',
  '      <mj-section background-color="#FAFBFC" padding="40px 24px">',
  '        <mj-column width="50%">',
  '          <mj-image height="150px" src="https://images.unsplash.com/photo-1547658719-da2b51169166?q=80&w=800&auto=format&fit=crop" padding="0" alt="Editor Preview" />',
  '        </mj-column>',
  '        <mj-column width="50%">',
  '          <mj-text font-weight="600" padding="0 0 8px">',
  '            Live Visual Editing',
  '          </mj-text>',
  '          <mj-text padding="0 0 16px">',
  '            Instantly preview changes inside the editor canvas. Adjust fonts, spacing, and colors with full control.',
  '          </mj-text>',
  '          <mj-button background-color="#262626" color="#FFFFFF" href="#">',
  '            View Documentation',
  '          </mj-button>',
  '        </mj-column>',
  '      </mj-section>',
  '',
  '      <!-- DIVIDER -->',
  '      <mj-section background-color="#FFFFFF" padding="0 24px">',
  '        <mj-column>',
  '          <mj-divider border-color="#E3E7EB" border-width="1px" />',
  '        </mj-column>',
  '      </mj-section>',
  '',
  '      <!-- FINAL CTA BLOCK -->',
  '      <mj-section background-color="#FFFFFF" padding="40px 24px">',
  '        <mj-column>',
  '          <mj-text font-size="20px" font-weight="700" padding="0 0 12px">',
  '            Ready to Launch Your Campaign?',
  '          </mj-text>',
  '          <mj-text padding="0 0 20px">',
  '            Create stunning, responsive email templates using your custom GrapesJS MJML editor.',
  '          </mj-text>',
  '          <mj-button background-color="#86BD40" color="#FFFFFF" href="#">',
  '            Create Your First Email',
  '          </mj-button>',
  '        </mj-column>',
  '      </mj-section>',
  '',
  '      <!-- FOOTER -->',
  '      <mj-section background-color="#FAFBFC" padding="24px">',
  '        <mj-column>',
  '          <mj-text font-size="12px" color="#66707A" align="center">',
  '            © 2026 Your Company · 123 Business Street · Manage Preferences · Unsubscribe',
  '          </mj-text>',
  '        </mj-column>',
  '      </mj-section>',
  '',
  '    </mj-wrapper>',
  '',
  '  </mj-body>',
  '</mjml>',
].join("\n");



    const applyStarterTemplateIfEmpty = () => {
      if (!allowStarterTemplateInjection) {
        return;
      }

      const wrapperComponent = editor.getWrapper() as UnknownComponent | null;

      if (!wrapperComponent) {
        return;
      }

      const bodyComponents = wrapperComponent.findType?.('mj-body');
      const bodyComponent = Array.isArray(bodyComponents)
        ? (bodyComponents[0] as UnknownComponent | undefined)
        : undefined;

      if (!bodyComponent) {
        return;
      }

      const bodyChildren = toComponentArray(bodyComponent.components?.());
      const hasMeaningfulChild = bodyChildren.some((child) => {
        const childType = getComponentType(child);

        if (!childType) {
          return false;
        }

        if (childType === 'textnode') {
          const content = child.get?.('content');
          return typeof content === 'string'
            ? content.trim().length > 0
            : Boolean(content);
        }

        return childType.startsWith('mj-') && childType !== 'mj-body';
      });

      if (hasMeaningfulChild) {
        allowStarterTemplateInjection = false;
        return;
      }

      editor.setComponents(sanitizeMjmlMarkup(initialTemplate));
      ensureMjBodyPresence();
    };

    applyStarterTemplateIfEmpty();

    // Add custom visual styling for native mj-group components
    // editor.on('load', () => {
    //   registerPrebuiltBlocks(editor);

    //   const desiredCategories = ['MEM', 'ERDC'];
    //   const categoriesCollection = editor.BlockManager.getCategories();
    //   const categoriesArray = Array.isArray(categoriesCollection)
    //     ? categoriesCollection
    //     : Array.isArray((categoriesCollection as { models?: unknown[] } | undefined)?.models)
    //       ? ((categoriesCollection as { models: unknown[] }).models as unknown[])
    //       : [];

    //   desiredCategories.forEach((label) => {
    //     const category = categoriesArray.find(
    //       (candidate) =>
    //         (candidate as { get?: (key: string) => unknown })?.get?.('label') === label,
    //     ) as { set?: (key: string, value: unknown) => void } | undefined;

    //     category?.set?.('open', true);
    //   });

    //   const rootComponent = editor.DomComponents.getWrapper();
    //   if (rootComponent) {
    //     deepSanitize(rootComponent);
    //   }

    //   applyStarterTemplateIfEmpty();
    //   const style = document.createElement('style');
    //   style.textContent = `
    //     .gjs-selected [data-gjs-type="mj-group"] {
    //       outline: 2px dashed #4CAF50 !important;
    //       outline-offset: 2px;
    //     }

    //     [data-gjs-type="mj-group"]::before {
    //       content: "GROUP";
    //       display: inline-block;
    //       background: #4CAF50;
    //       color: white;
    //       font-size: 10px;
    //       padding: 2px 6px;
    //       border-radius: 3px;
    //       margin-right: 8px;
    //     }
    //   `;
    //   document.head.appendChild(style);

    //   // Fix for MJML components with zero padding disappearing from canvas
    //   // Inject CSS into the canvas iframe after a delay to ensure it's ready
    //   setTimeout(() => {
    //     const injectCanvasStyles = () => {
    //       const canvasFrames = editor.Canvas.getFrames();
    //       canvasFrames.forEach((frame: { view?: { el?: HTMLIFrameElement } }) => {
    //         const iframe = frame.view?.el;
    //         if (iframe?.contentDocument?.head) {
    //           // Check if styles already injected
    //           if (iframe.contentDocument.getElementById('mjml-padding-fix')) {
    //             return;
    //           }

    //           const canvasStyle = iframe.contentDocument.createElement('style');
    //           canvasStyle.id = 'mjml-padding-fix';
    //           canvasStyle.textContent = `
    //             /* Ensure MJML wrapper components have minimum height */
    //             [data-gjs-type="mj-body"],
    //             [data-gjs-type="mj-wrapper"],
    //             [data-gjs-type="mj-section"],
    //             [data-gjs-type="mj-group"],
    //             [data-gjs-type="mj-column"] {
    //               min-height: 20px !important;
    //             }

    //             /* Make components with zero padding visible with subtle outline */
    //             [data-gjs-type="mj-section"][style*="padding: 0"],
    //             [data-gjs-type="mj-section"][style*="padding:0"],
    //             [data-gjs-type="mj-group"][style*="padding: 0"],
    //             [data-gjs-type="mj-group"][style*="padding:0"] {
    //               min-height: 50px !important;
    //               box-shadow: inset 0 0 0 1px rgba(150, 150, 150, 0.3) !important;
    //             }
    //           `;
    //           iframe.contentDocument.head.appendChild(canvasStyle);
    //         }
    //       });
    //     };

    //     // Inject styles initially
    //     injectCanvasStyles();

    //     // Re-inject on frame updates (when canvas reloads)
    //     editor.on('frame:load', injectCanvasStyles);
    //   }, 100);

    //   allowStarterTemplateInjection = false;
    // });

    editor.on('component:remove', ensureMjBodyPresence);
    editor.on('run:core:canvas-clear', () => {
      setTimeout(ensureMjBodyPresence, 0);
    });
    editor.on('component:add', (component) => {
      deepSanitize(component as GjsComponent);
      ensureComponentInMjBody(component as UnknownComponent);
    });

    editor.on('component:update:attributes', (component) => {
      sanitizeComponentAttributes(component as GjsComponent);
    });

    editor.on('component:styleUpdate', (component) => {
      sanitizeComponentStyles(component as GjsComponent);
      sanitizeComponentAttributes(component as GjsComponent);
    });

    console.log('Tip: mj-group contains columns that stay side-by-side on mobile (instead of stacking)');

    // Add the Microsoft Aptos system font to the typography control
    const registerAptosFont = () => {
      const styleManager = editor.StyleManager as unknown as {
        getProperty: (sector: string, id: string) => unknown;
      };
      const fontProperty =
        (styleManager?.getProperty?.('typography', 'font-family') as {
          getOptions?: () => unknown;
          get?: (key: string) => unknown;
          setOptions?: (options: unknown) => void;
          addOption?: (option: unknown) => void;
          set?: (key: string, value: unknown) => void;
        } | undefined) ?? undefined;

      if (!fontProperty) {
        return;
      }

      const aptosStack = 'Aptos, Calibri, sans-serif';
      const aptosOption = { id: aptosStack, label: 'Aptos (system)' };
      const rawOptions =
        typeof fontProperty.getOptions === 'function'
          ? fontProperty.getOptions()
          : fontProperty.get?.('options') ?? fontProperty.get?.('list');
      const options: unknown[] = Array.isArray(rawOptions) ? rawOptions : [];

      const hasAptos = options.some((option) => {
        if (typeof option === 'string') {
          return option.toLowerCase().includes('aptos');
        }

        if (option && typeof option === 'object') {
          const candidate =
            (option as { id?: unknown }).id ?? (option as { value?: unknown }).value;
          return typeof candidate === 'string' && candidate.toLowerCase().includes('aptos');
        }

        return false;
      });

      if (hasAptos) {
        return;
      }

      const updatedOptions = [aptosOption, ...options];

      if (typeof fontProperty.setOptions === 'function') {
        fontProperty.setOptions(updatedOptions);
      } else if (typeof fontProperty.addOption === 'function') {
        fontProperty.addOption(aptosOption);
      } else if (typeof fontProperty.set === 'function') {
        fontProperty.set('options', updatedOptions);
      }
    };

    registerAptosFont();
    editor.on('load', registerAptosFont);

    console.log('Available blocks:', editor.BlockManager.getAll().length);
    console.log('Block IDs:', editor.BlockManager.getAll().map((b: { getId: () => string }) => b.getId()));

    // Add mj-group block to the Block Manager (uncomment to enable)
    // mj-group wraps columns to keep them side-by-side on mobile
    const _mjGroupBlockMarkup = [
      '<mj-section>',
      '  <mj-group>',
      '    <mj-column width="50%">',
      '      <mj-text>Column 1</mj-text>',
      '    </mj-column>',
      '    <mj-column width="50%">',
      '      <mj-text>Column 2</mj-text>',
      '    </mj-column>',
      '  </mj-group>',
    '</mj-section>',
    ].join('\n');
    void _mjGroupBlockMarkup; // reserved for BlockManager.add('mj-group', { content: sanitizeMjmlMarkup(_mjGroupBlockMarkup), ... })

    // editor.BlockManager.add('mj-group', {
    //   label: 'Group',
    //   category: 'Basic',
    //   content: sanitizeMjmlMarkup(mjGroupBlockMarkup),
    //   media: `<svg viewBox="0 0 24 24" fill="currentColor">
    //     <path d="M3,3H21V7H3V3M3,9H21V11H3V9M3,13H21V21H3V13M5,15V19H19V15H5Z" />
    //   </svg>`,
    //   attributes: { class: 'fa fa-object-group' },
    // });

    console.log('Available blocks after adding mj-group:', editor.BlockManager.getAll().length);
  }, []);

  return (
    <GjsEditor
      grapesjs={grapesjs}
      grapesjsCss="https://unpkg.com/grapesjs/dist/css/grapes.min.css"
      options={{
        height: '100vh',
        storageManager: false,
        plugins: [mjmlPlugin],
      }}
      onEditor={handleEditorReady}
    >
      <div className="editor-container gjs-one-bg gjs-two-color">
        <WithEditor>
          <Topbar />
        </WithEditor>
        <div className="editor-body">
          <LeftSidebar />
          <div className="canvas-container">
            <Canvas className="canvas-area" />
          </div>
          <RightSidebar />
        </div>
      </div>
    </GjsEditor>
  );
}
