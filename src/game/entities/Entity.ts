/**
 * 组件与实体基类：实体只做容器，行为由组件组合。
 */
export abstract class Component {
  entity!: Entity;

  attach(entity: Entity): void {
    this.entity = entity;
  }

  abstract update(dt: number): void;

  detach(): void {
    /* 子类按需清理 */
  }
}

export abstract class Entity {
  private static nextId = 1;
  readonly id = Entity.nextId++;
  x = 0;
  z = 0;
  alive = true;

  private readonly components = new Map<Function, Component>();

  add<T extends Component>(component: T): T {
    this.components.set(component.constructor as Function, component);
    component.attach(this);
    return component;
  }

  get<T extends Component>(ctor: new (...args: never[]) => T): T | undefined {
    return this.components.get(ctor) as T | undefined;
  }

  has(ctor: Function): boolean {
    return this.components.has(ctor);
  }

  update(dt: number): void {
    for (const component of this.components.values()) component.update(dt);
  }

  dispose(): void {
    for (const component of this.components.values()) component.detach();
    this.components.clear();
    this.alive = false;
  }
}
